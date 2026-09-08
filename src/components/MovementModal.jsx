import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { diasClient, formatSupabaseError } from '../lib/supabase'
import { movementFormFromRow, parseMovementAmount, extractLedgerAmount, isBareEuroText, normalizeEntryDate } from '../lib/techLedger'
import { fromElInputValue, toElInputDisplay } from '../lib/numberFormat'
import {
  HIDDEN_LEDGER_TYPE_IDS,
  OTHER_CREDIT_IDS,
  OTHER_DEBIT_IDS,
  SALARY_CREDIT_IDS,
  SALARY_DEBIT_IDS,
} from '../lib/ledgerMapping'
import {
  buildTypeLookup,
  defaultSideForType,
  isSalaryLedgerGroup,
  ledgerColumnFor,
  ledgerColumnLabel,
  ledgerGroupLabel,
  paymentCreditColumns,
  paymentTypeCodeFromDescription,
  payrollTypeCodeFromDescription,
  resolveTransactionTypeFromLedgerRow,
  shouldPostAsPayment,
  sideFromLedgerBucket,
} from '../lib/transactionTypes'
import DarkSelect from './DarkSelect'
import GreekDateInput from './GreekDateInput'
import { parseToIsoDate } from '../lib/greekDate'
import { useDraggableModal, MODAL_POS_KEYS } from '../lib/useDraggableModal'
import {
  LOAN_DISBURSEMENT_TYPE_ID,
  LOAN_INSTALLMENT_TYPE_ID,
  isLoanInstallmentRow,
  loanSeriesNotesKey,
} from '../lib/loanUi'

const INVOICE_CREDIT_TYPE_ID = 93

/** Δώρα μετρητά — σε Χρέωση εμφανίζονται σε κάθε Κατηγορία (Μισθός/Λοιπά/Τιμολόγιο). */
const CROSS_CATEGORY_DEBIT_GIFT_IDS = new Set([11, 12])

/** Τύποι που δημιουργούνται αλλού (settlement / LoanModal / αποδοχές) — όχι χειροκίνητα. */
const EXCLUDED_MANUAL_TYPE_IDS = new Set([
  1, 2, 3, 10, 14, 24, 91, 92, 93, 94, 95,
  // σταθερές αποδοχές / auto-transfer
  5, // Extra Bonus
  21, // Επίδομα Οδηγού
  23, // Λογιστής
  41, // Bonus +
])

/** Λεκτικό backup για μελλοντικά IDs με ίδια σημασία. */
const EXCLUDED_MANUAL_LABEL_RE =
  /εξόφλησ|εξοφλησ|προκαταβολ|δάνειο|δανειο|δόση|δοση|εκταμίευσ|εκταμιευσ|ticket|bonus\s*\+|extra\s*bonus|επίδομα\s*οδηγ|επιδομα\s*οδηγ|λογιστ/i

const EMPTY_TYPE_PLACEHOLDER = 'Δεν υπάρχουν διαθέσιμοι τύποι για χειροκίνητη εισαγωγή'

const CATEGORY_BASE = [
  { value: 'SALARY', label: 'Μισθός' },
  { value: 'OTHER', label: 'Λοιπά' },
]

/** Τιμολόγιο πρώτο — default για νέα χειροκίνητη Εισαγωγή. */
const CATEGORY_WITH_INVOICE = [
  { value: 'INVOICE', label: 'Τιμολόγιο' },
  ...CATEGORY_BASE,
]

const SIDE_OPTIONS = [
  { value: 'DEBIT', label: 'Χρέωση' },
  { value: 'CREDIT', label: 'Πίστωση' },
]

function typeIsSalary(t) {
  if (!t) return false
  if (t.ledger_group) return isSalaryLedgerGroup(t.ledger_group)
  return Number(t.col_index) === 1
}

function normalizeCategory(value) {
  const g = String(value || '').toUpperCase()
  if (g === 'INVOICE') return 'INVOICE'
  if (g === 'SALARY') return 'SALARY'
  return 'OTHER'
}

/** Κατηγορία UI από bucket / form / τύπο. */
function resolveUiCategory({ postToInvoice, ledgerGroup, type }) {
  if (postToInvoice || normalizeCategory(ledgerGroup) === 'INVOICE') return 'INVOICE'
  if (typeIsSalary(type) || normalizeCategory(ledgerGroup) === 'SALARY') return 'SALARY'
  return 'OTHER'
}

function isExcludedManualType(t) {
  if (!t) return true
  const id = Number(t.id)
  if (EXCLUDED_MANUAL_TYPE_IDS.has(id)) return true
  return EXCLUDED_MANUAL_LABEL_RE.test(String(t.description || ''))
}

function isExcludedManualTypeId(id, types = []) {
  if (id == null || id === '') return false
  const n = Number(id)
  if (EXCLUDED_MANUAL_TYPE_IDS.has(n)) return true
  const t = types.find((x) => Number(x.id) === n)
  return t ? isExcludedManualType(t) : false
}

/**
 * Φίλτρο τύπων με βάση Κατηγορία + Κατεύθυνση.
 * Τιμολόγιο: πίστωση → μόνο 93 · χρέωση → δεδουλευμένα (όχι εξοφλήσεις).
 * Δώρα 11/12: σε Χρέωση → όλες οι κατηγορίες (και Τιμολόγιο → invoice_amount).
 */
function filterTypesForCategorySide(types, category, side) {
  const cat = normalizeCategory(category)
  const credit = String(side || '').toUpperCase() === 'CREDIT'
  const list = Array.isArray(types) ? types : []

  return list.filter((t) => {
    const id = Number(t.id)
    if (HIDDEN_LEDGER_TYPE_IDS.has(id)) return false

    // Δώρο Πάσχα / Χριστουγέννων: bypass ledger_group σε κάθε Κατηγορία (μόνο Χρέωση)
    if (!credit && CROSS_CATEGORY_DEBIT_GIFT_IDS.has(id)) return true

    if (cat === 'INVOICE') {
      if (credit) return id === INVOICE_CREDIT_TYPE_ID
      if (id === INVOICE_CREDIT_TYPE_ID) return false
      if (SALARY_CREDIT_IDS.has(id) || OTHER_CREDIT_IDS.has(id)) return false
      return true
    }

    if (cat === 'SALARY') {
      if (!typeIsSalary(t)) return false
      if (credit) return SALARY_CREDIT_IDS.has(id)
      return SALARY_DEBIT_IDS.has(id) || !SALARY_CREDIT_IDS.has(id)
    }

    // OTHER — αποκλείουμε 93 (ανήκει στο Τιμολόγιο)
    if (typeIsSalary(t) || id === INVOICE_CREDIT_TYPE_ID) return false
    if (credit) {
      return (
        OTHER_CREDIT_IDS.has(id) ||
        defaultSideForType(t.description) === 'CREDIT'
      )
    }
    if (OTHER_CREDIT_IDS.has(id)) return false
    if (OTHER_DEBIT_IDS.has(id)) return true
    return defaultSideForType(t.description) !== 'CREDIT'
  })
}

/** Μετά το category/side: κόψε auto/settlement τύπους · allowTypeId = edit/preset exception. */
function applyManualTypeExclusion(types, allowTypeId = null) {
  const allow = allowTypeId != null && allowTypeId !== '' ? Number(allowTypeId) : null
  return (types || []).filter((t) => {
    if (allow != null && Number(t.id) === allow) return true
    return !isExcludedManualType(t)
  })
}

/** 11/12 πάντα στο κάτω μέρος της λίστας Τύπου. */
function sortMovementTypeOptions(types) {
  return [...(types || [])].sort((a, b) => {
    const aGift = CROSS_CATEGORY_DEBIT_GIFT_IDS.has(Number(a.id)) ? 1 : 0
    const bGift = CROSS_CATEGORY_DEBIT_GIFT_IDS.has(Number(b.id)) ? 1 : 0
    if (aGift !== bGift) return aGift - bGift
    const orderA = Number(a.sort_order ?? 0)
    const orderB = Number(b.sort_order ?? 0)
    if (orderA !== orderB) return orderA - orderB
    return Number(a.id) - Number(b.id)
  })
}

function getFilteredMovementTypes(types, category, side, allowTypeId = null) {
  let base = applyManualTypeExclusion(
    filterTypesForCategorySide(types, category, side),
    allowTypeId
  )
  if (allowTypeId != null && allowTypeId !== '') {
    const allow = Number(allowTypeId)
    if (!base.some((t) => Number(t.id) === allow)) {
      const extra = (types || []).find((t) => Number(t.id) === allow)
      if (extra) base = [extra, ...base]
    }
  }
  return sortMovementTypeOptions(base)
}

/**
 * Κίνηση modal — οδηγείται από Κατηγορία + Κατεύθυνση · ο Τύπος φιλτράρεται.
 * Αποθήκευση: DEBIT→payroll_entries · CREDIT→payment_entries (αμετάβλητο).
 */
export default function MovementModal({
  open,
  selectedRowData,
  tech,
  presetTypeId = null,
  presetSide = null,
  presetDescription = null,
  presetAmount = null,
  presetPostToInvoice = null,
  presetMonth = null,
  presetYear = null,
  hasInvoice = false,
  onClose,
  onSaved,
  error: externalError = null,
}) {
  const [form, setForm] = useState(() => movementFormFromRow(null))
  const [types, setTypes] = useState([])
  const [typesLoading, setTypesLoading] = useState(false)
  const [typesError, setTypesError] = useState(null)
  const [selectedTypeId, setSelectedTypeId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [loanDeleteOpen, setLoanDeleteOpen] = useState(false)
  const { panelStyle, dragHandleProps, dragHandleClassName } = useDraggableModal(
    open,
    MODAL_POS_KEYS.movement
  )
  const {
    panelStyle: deletePanelStyle,
    dragHandleProps: deleteDragHandleProps,
    dragHandleClassName: deleteDragHandleClassName,
  } = useDraggableModal(loanDeleteOpen, MODAL_POS_KEYS.movementLoanDelete)
  const [deleting, setDeleting] = useState(false)
  /** Edit τιμολογίου χωρίς hasInvoice: κράτα την επιλογή Κατηγορίας σε όλο το session. */
  const [allowInvoiceCategory, setAllowInvoiceCategory] = useState(false)

  const isEdit = Boolean(selectedRowData?.id)
  const rowSource = selectedRowData?.source || 'PAYROLL'
  const showLoanDelete = isEdit && isLoanInstallmentRow(selectedRowData)

  const uiCategory = normalizeCategory(form.ledger_group)
  const postToInvoice = uiCategory === 'INVOICE'

  const showInvoiceCategory = hasInvoice === true || allowInvoiceCategory

  const categoryOptions = showInvoiceCategory ? CATEGORY_WITH_INVOICE : CATEGORY_BASE

  /** Edit / settlement preset: κράτα excluded τύπο ορατό & κλειδωμένο. */
  const exceptionTypeId = useMemo(() => {
    if (presetTypeId != null && isExcludedManualTypeId(presetTypeId, types)) {
      return Number(presetTypeId)
    }
    if (isEdit && selectedRowData) {
      const fromRow =
        selectedTypeId ??
        selectedRowData.type_id ??
        selectedRowData.ept_id ??
        null
      if (fromRow != null && isExcludedManualTypeId(fromRow, types)) {
        return Number(fromRow)
      }
    }
    return null
  }, [presetTypeId, isEdit, selectedRowData, selectedTypeId, types])

  const typeSelectLocked = exceptionTypeId != null

  const filteredTypes = useMemo(
    () => getFilteredMovementTypes(types, uiCategory, form.side, exceptionTypeId),
    [types, uiCategory, form.side, exceptionTypeId]
  )

  const noAvailableTypes = !typesLoading && filteredTypes.length === 0

  const selectedType = useMemo(
    () => types.find((t) => Number(t.id) === Number(selectedTypeId)) || null,
    [types, selectedTypeId]
  )

  const targetColumn = useMemo(() => {
    if (!form.side) return null
    if (postToInvoice || uiCategory === 'INVOICE') {
      return ledgerColumnFor('INVOICE', form.side)
    }
    if (!selectedType) return null
    return ledgerColumnFor(
      selectedType.ledger_group || (typeIsSalary(selectedType) ? 'SALARY' : 'OTHER'),
      form.side
    )
  }, [selectedType, form.side, postToInvoice, uiCategory])

  const applyTypeKeepDrivers = (t, category, side) => {
    if (!t) return
    const cat = normalizeCategory(category)
    const salary = typeIsSalary(t)
    setForm((prev) => ({
      ...prev,
      type: t.description,
      is_salary_type: salary,
      ledger_group: cat,
      side: side || prev.side || 'DEBIT',
      post_to_invoice: cat === 'INVOICE',
    }))
  }

  const pickTypeForDrivers = (list, preferredId, category, side) => {
    const preferred =
      preferredId != null
        ? list.find((t) => Number(t.id) === Number(preferredId))
        : null
    const chosen = preferred || list[0] || null
    setSelectedTypeId(chosen?.id ?? null)
    if (chosen) applyTypeKeepDrivers(chosen, category, side)
    return chosen
  }

  useEffect(() => {
    if (!open) return
    setForm(movementFormFromRow(selectedRowData))
    setTypesError(null)
    setSaveError(null)
    setLoanDeleteOpen(false)
    setDeleting(false)
    setAllowInvoiceCategory(hasInvoice === true)

    let cancelled = false
    async function loadTypes() {
      setTypesLoading(true)
      try {
        const { data, error: err } = await diasClient
          .from('transaction_types')
          .select(
            'id, description, ledger_group, is_for_sum, sort_order, is_active, ept_type_pay, col_index'
          )
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true })

        if (cancelled) return
        if (err) throw err

        const list = data || []
        setTypes(list)
        const lookup = buildTypeLookup(list)

        let match = null
        if (presetTypeId != null) {
          match = list.find((t) => Number(t.id) === Number(presetTypeId))
        } else if (selectedRowData) {
          match = resolveTransactionTypeFromLedgerRow(lookup, selectedRowData)
        }

        const base = selectedRowData
          ? movementFormFromRow(selectedRowData)
          : movementFormFromRow(null)
        const { bucket } = selectedRowData
          ? extractLedgerAmount(selectedRowData)
          : { bucket: null }

        const side =
          presetSide ||
          base.side ||
          (bucket ? sideFromLedgerBucket(bucket) : null) ||
          (match ? defaultSideForType(match.description) : null) ||
          'DEBIT'

        const postInvoiceFlag = selectedRowData
          ? bucket === 'invoice_amount' ||
            bucket === 'invoice_credit' ||
            base.post_to_invoice === true
          : presetPostToInvoice === true || base.post_to_invoice === true

        const category = (() => {
          // Νέα Εισαγωγή (χωρίς edit / χωρίς preset τύπου): Τιμολόγιο πάνω-πάνω by default
          if (!selectedRowData && presetTypeId == null && hasInvoice === true) {
            return 'INVOICE'
          }
          return resolveUiCategory({
            postToInvoice: postInvoiceFlag,
            ledgerGroup: base.ledger_group,
            type: match,
          })
        })()

        if (hasInvoice === true || category === 'INVOICE') {
          setAllowInvoiceCategory(true)
        }

        const allowId =
          match && isExcludedManualType(match)
            ? Number(match.id)
            : presetTypeId != null && isExcludedManualTypeId(presetTypeId, list)
              ? Number(presetTypeId)
              : null

        const filtered = getFilteredMovementTypes(list, category, side, allowId)
        // Edit / preset excluded: κράτα τον τύπο · αλλιώς μόνο από φιλτραρισμένη λίστα
        let chosen = match
        if (chosen) {
          const inFiltered = filtered.some((t) => Number(t.id) === Number(chosen.id))
          if (!inFiltered) {
            if (allowId != null && Number(chosen.id) === allowId) {
              // κρατείται via exception
            } else if (isEdit) {
              // legacy edit εκτός φίλτρου — κράτα
            } else {
              chosen = filtered[0] || null
            }
          }
        } else {
          chosen = filtered[0] || null
        }

        setSelectedTypeId(chosen?.id ?? null)
        setForm({
          ...base,
          type: chosen?.description || base.type,
          description:
            !selectedRowData && presetDescription
              ? presetDescription
              : isBareEuroText(base.description)
                ? ''
                : base.description,
          amount:
            !selectedRowData && presetAmount != null && presetAmount !== ''
              ? String(presetAmount)
              : base.amount,
          is_salary_type: typeIsSalary(chosen),
          ledger_group: category,
          side,
          post_to_invoice: category === 'INVOICE',
        })
      } catch (err) {
        if (!cancelled) {
          setTypes([])
          setTypesError(
            formatSupabaseError(err, { table: 'transaction_types', clientLabel: 'DIAS ERP' }) ||
              err.message ||
              'Λείπει ledger_group — τρέξε supabase/07_transaction_types_ledger_group.sql'
          )
        }
      } finally {
        if (!cancelled) setTypesLoading(false)
      }
    }

    loadTypes()
    return () => {
      cancelled = true
    }
  }, [open, selectedRowData, presetTypeId, presetSide, presetDescription, presetAmount, presetPostToInvoice, hasInvoice])

  if (!open) return null

  const patch = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const handleCategoryChange = (value) => {
    const category = normalizeCategory(value)
    const side = form.side || 'DEBIT'
    const nextFiltered = getFilteredMovementTypes(types, category, side, exceptionTypeId)
    setForm((prev) => ({
      ...prev,
      ledger_group: category,
      post_to_invoice: category === 'INVOICE',
    }))
    pickTypeForDrivers(
      nextFiltered,
      typeSelectLocked ? exceptionTypeId : selectedTypeId,
      category,
      side
    )
  }

  const handleSideChange = (value) => {
    const side = String(value || 'DEBIT').toUpperCase() === 'CREDIT' ? 'CREDIT' : 'DEBIT'
    const category = uiCategory
    const nextFiltered = getFilteredMovementTypes(types, category, side, exceptionTypeId)
    setForm((prev) => ({ ...prev, side }))
    pickTypeForDrivers(
      nextFiltered,
      typeSelectLocked ? exceptionTypeId : selectedTypeId,
      category,
      side
    )
  }

  const handleTypeChange = (typeId) => {
    if (typeSelectLocked) return
    const id = Number(typeId)
    if (!Number.isFinite(id)) return
    setSelectedTypeId(id)
    const t = types.find((x) => Number(x.id) === id)
    if (!t) return
    applyTypeKeepDrivers(t, uiCategory, form.side)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaveError(null)

    if (typesLoading || !selectedType || noAvailableTypes) {
      const msg = typesLoading
        ? 'Περίμενε φόρτωση τύπων...'
        : noAvailableTypes
          ? EMPTY_TYPE_PLACEHOLDER
          : 'Επίλεξε τύπο κίνησης'
      setSaveError(msg)
      toast.error(msg)
      return
    }
    if (!tech?.id) {
      const msg = 'Δεν έχει επιλεγεί υπάλληλος'
      setSaveError(msg)
      toast.error(msg)
      return
    }

    let amount
    try {
      amount = parseMovementAmount(form.amount)
    } catch (err) {
      const msg = err.message || String(err)
      setSaveError(msg)
      toast.error(msg)
      return
    }

    const isSalary = typeIsSalary(selectedType)
    const side = form.side || 'DEBIT'
    const postAsPayment = shouldPostAsPayment(side)
    // Κατηγορία=Τιμολόγιο → invoice στήλες (χωρίς checkbox)
    const invoiceFlag = normalizeCategory(form.ledger_group) === 'INVOICE'
    const invoiceAmount = invoiceFlag && !postAsPayment ? amount : 0
    const rawDescription = form.description?.trim() || ''
    const description =
      rawDescription && !isBareEuroText(rawDescription) ? rawDescription : null
    const notes = form.notes?.trim() || null
    const entryDateIso =
      parseToIsoDate(form.entry_date) || normalizeEntryDate(form.entry_date)
    if (!entryDateIso || !/^\d{4}-\d{2}-\d{2}$/.test(entryDateIso)) {
      const msg = 'Μη έγκυρη ημερομηνία. Χρησιμοποίησε μορφή ηη/μμ/εεεε.'
      setSaveError(msg)
      toast.error(msg)
      return
    }

    const periodMonth =
      Number(presetMonth) ||
      Number(selectedRowData?.month) ||
      Number(String(entryDateIso).slice(5, 7)) ||
      null
    const periodYear =
      Number(presetYear) ||
      Number(selectedRowData?.year) ||
      Number(String(entryDateIso).slice(0, 4)) ||
      null

    setSaving(true)
    try {
      if (isEdit) {
        if (rowSource === 'PAYMENT') {
          const paymentType = paymentTypeCodeFromDescription(
            selectedType.description,
            selectedType.ledger_group
          )
          const credits = paymentCreditColumns({
            amount,
            paymentType,
            postToInvoice: invoiceFlag,
            typeId: selectedType.id,
            ledgerGroup: selectedType.ledger_group,
          })
          const { error } = await diasClient
            .from('payment_entries')
            .update({
              payment_date: entryDateIso,
              payment_type: paymentType,
              amount,
              ...credits,
              notes,
              entry_date: entryDateIso,
              entry_type: paymentType,
              description,
              tech_name: tech.displayName || tech.name || null,
              month: periodMonth,
              year: periodYear,
              type_id: Number(selectedType.id) || null,
            })
            .eq('id', selectedRowData.id)
          if (error) throw error
        } else {
          const { error } = await diasClient
            .from('payroll_entries')
            .update({
              reference_date: entryDateIso,
              type_code: payrollTypeCodeFromDescription(selectedType.description),
              description,
              notes,
              amount,
              invoice_amount: invoiceAmount,
              is_salary_type: isSalary,
              month: periodMonth,
              year: periodYear,
            })
            .eq('id', selectedRowData.id)
          if (error) throw error
        }
      } else if (postAsPayment) {
        const paymentType = paymentTypeCodeFromDescription(
          selectedType.description,
          selectedType.ledger_group
        )
        const credits = paymentCreditColumns({
          amount,
          paymentType,
          postToInvoice: invoiceFlag,
          typeId: selectedType.id,
          ledgerGroup: selectedType.ledger_group,
        })
        const { error } = await diasClient.from('payment_entries').insert({
          tech_id: String(tech.id),
          tech_name: tech.displayName || tech.name || null,
          payment_date: entryDateIso,
          payment_type: paymentType,
          amount,
          ...credits,
          notes,
          entry_date: entryDateIso,
          entry_type: paymentType,
          description,
          month: periodMonth,
          year: periodYear,
          type_id: Number(selectedType.id) || null,
        })
        if (error) throw error
      } else {
        const { error } = await diasClient.from('payroll_entries').insert({
          tech_id: String(tech.id),
          reference_date: entryDateIso,
          type_code: payrollTypeCodeFromDescription(selectedType.description),
          description,
          notes,
          amount,
          invoice_amount: invoiceAmount,
          is_salary_type: isSalary,
          month: periodMonth,
          year: periodYear,
        })
        if (error) throw error
      }

      onSaved?.({
        wasPayment: isEdit ? rowSource === 'PAYMENT' : postAsPayment,
      })
      toast.success(isEdit ? 'Η κίνηση ενημερώθηκε.' : 'Η κίνηση αποθηκεύτηκε.')
      onClose?.()
    } catch (err) {
      const table =
        isEdit
          ? rowSource === 'PAYMENT'
            ? 'payment_entries'
            : 'payroll_entries'
          : postAsPayment
            ? 'payment_entries'
            : 'payroll_entries'
      const msg =
        formatSupabaseError(err, { table, clientLabel: 'DIAS ERP' }) ||
        err.message ||
        String(err)
      setSaveError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCurrentInstallment = async () => {
    if (!selectedRowData?.id) return
    const targetTable = rowSource === 'PAYMENT' ? 'payment_entries' : 'payroll_entries'
    setDeleting(true)
    try {
      const { error } = await diasClient.from(targetTable).delete().eq('id', selectedRowData.id)
      if (error) throw error
      toast.success('Η δόση διαγράφηκε')
      setLoanDeleteOpen(false)
      onSaved?.({ wasPayment: true })
      onClose?.()
    } catch (err) {
      const msg =
        formatSupabaseError(err, { table: targetTable, clientLabel: 'DIAS ERP' }) ||
        err?.message ||
        String(err)
      toast.error(msg || 'Αποτυχία διαγραφής δόσης.')
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteLoanSeries = async () => {
    if (!selectedRowData) return
    const techId = selectedRowData.tech_id ?? tech?.id
    const paymentDateRaw = selectedRowData.payment_date || selectedRowData.entry_date
    const paymentDate = paymentDateRaw ? String(paymentDateRaw).slice(0, 10) : ''
    const seriesKey = loanSeriesNotesKey(selectedRowData.notes)
    if (!techId || !paymentDate || !seriesKey) {
      toast.error('Δεν βρέθηκαν στοιχεία σύνδεσης της σειράς δανείου.')
      return
    }
    setDeleting(true)
    try {
      const { error: installmentsError } = await diasClient
        .from('payment_entries')
        .delete()
        .eq('tech_id', techId)
        .eq('type_id', LOAN_INSTALLMENT_TYPE_ID)
        .eq('payment_date', paymentDate)
        .like('notes', `${seriesKey}%`)
      if (installmentsError) throw installmentsError

      const { error: disbursementError } = await diasClient
        .from('payment_entries')
        .delete()
        .eq('tech_id', techId)
        .eq('type_id', LOAN_DISBURSEMENT_TYPE_ID)
        .eq('payment_date', paymentDate)
        .like('notes', `Εκταμίευση Δανείου: ${seriesKey}%`)
      if (disbursementError) throw disbursementError

      toast.success('Ολόκληρη η σειρά του δανείου διαγράφηκε')
      setLoanDeleteOpen(false)
      onSaved?.({ wasPayment: true })
      onClose?.()
    } catch (err) {
      const msg =
        formatSupabaseError(err, { table: 'payment_entries', clientLabel: 'DIAS ERP' }) ||
        err?.message ||
        String(err)
      toast.error(msg || 'Αποτυχία διαγραφής σειράς δανείου.')
    } finally {
      setDeleting(false)
    }
  }

  const displayError = saveError || externalError
  const formDisabled = typesLoading || types.length === 0 || saving || deleting
  const saveDisabled =
    formDisabled || noAvailableTypes || !selectedType || selectedTypeId == null

  const typeSelectOptions = (() => {
    if (noAvailableTypes) {
      return [{ value: '', label: EMPTY_TYPE_PLACEHOLDER }]
    }
    const opts = filteredTypes.map((t) => ({
      value: t.id,
      label: t.description,
    }))
    if (
      selectedType &&
      !opts.some((o) => Number(o.value) === Number(selectedType.id))
    ) {
      opts.unshift({
        value: selectedType.id,
        label: isEdit ? `${selectedType.description} (τρέχον)` : selectedType.description,
      })
    }
    return opts
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/20 backdrop-blur-none"
        aria-label="Κλείσιμο"
        onClick={onClose}
        disabled={saving || deleting}
      />
      <form
        onSubmit={handleSave}
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
        style={panelStyle}
      >
        <div
          className={`flex items-start justify-between gap-3 ${dragHandleClassName}`}
          {...dragHandleProps}
        >
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Καρτέλα
            </p>
            <h3 className="text-lg font-bold text-white">
              {isEdit ? 'Επεξεργασία Κίνησης' : 'Κίνηση'}
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {typesLoading
                ? 'Φόρτωση τύπων από transaction_types...'
                : isEdit
                  ? `Επεξεργασία · ${rowSource === 'PAYMENT' ? 'Πίστωση' : 'Χρέωση'} · ${selectedRowData?.entry_date ? new Date(selectedRowData.entry_date).toLocaleDateString('el-GR') : ''}`
                  : shouldPostAsPayment(form.side)
                    ? 'Νέα πίστωση → payment_entries'
                    : 'Νέα χρέωση → payroll_entries'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving || deleting}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-slate-950/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Στοιχεία</p>

          {(typesError || typesLoading) && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                typesError
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                  : 'border-white/10 bg-white/5 text-slate-400'
              }`}
            >
              {typesError || 'Φόρτωση τύπων από Supabase...'}
            </div>
          )}

          <fieldset disabled={formDisabled} className="space-y-3 disabled:opacity-60">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Ημερομηνία
              </label>
              <GreekDateInput
                value={form.entry_date || ''}
                onChange={(iso) => patch('entry_date', iso)}
                withPicker
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Κατηγορία
                </label>
                <DarkSelect
                  value={uiCategory}
                  onChange={(v) => handleCategoryChange(v)}
                  className="mt-1 w-full"
                  options={categoryOptions}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Κατεύθυνση
                </label>
                <DarkSelect
                  value={form.side || 'DEBIT'}
                  onChange={(v) => handleSideChange(v)}
                  className="mt-1 w-full"
                  options={SIDE_OPTIONS}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Τύπος
              </label>
              <DarkSelect
                value={noAvailableTypes ? '' : (selectedTypeId ?? '')}
                onChange={(v) => handleTypeChange(v)}
                className="mt-1 w-full"
                options={typeSelectOptions}
                disabled={typeSelectLocked || noAvailableTypes}
                placeholder={EMPTY_TYPE_PLACEHOLDER}
              />
              {typeSelectLocked && (
                <p className="mt-1 text-[10px] text-slate-500">
                  Ο τύπος ορίστηκε αυτόματα και δεν αλλάζει χειροκίνητα.
                </p>
              )}
            </div>

            {targetColumn && (
              <p className="rounded-lg border border-white/5 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-400">
                Στόχος στο grid:{' '}
                <span className="font-semibold text-slate-200">{ledgerColumnLabel(targetColumn)}</span>
              </p>
            )}

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Περιγραφή
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder="π.χ. 20.00 ώρα/ες x 15.00 €"
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-600"
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Ποσό (€)
              </label>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                required
                value={toElInputDisplay(form.amount)}
                onChange={(e) => patch('amount', fromElInputValue(e.target.value))}
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white"
              />
            </div>

            {selectedType && !typesLoading && (
              <p className="text-[11px] text-slate-500">
                id={selectedType.id} · {ledgerGroupLabel(selectedType.ledger_group)} · is_for_sum=
                {String(selectedType.is_for_sum)}
              </p>
            )}

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Σημειώσεις
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => patch('notes', e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
              />
            </div>
          </fieldset>
        </div>

        {displayError && (
          <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {displayError}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving || deleting}
            className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-2.5 text-sm font-bold text-rose-100 disabled:opacity-50"
          >
            Έξοδος
          </button>
          {showLoanDelete && (
            <button
              type="button"
              onClick={() => setLoanDeleteOpen(true)}
              disabled={saving || deleting}
              className="rounded-xl border border-red-500/50 bg-red-600/30 px-4 py-2.5 text-sm font-bold text-red-100 hover:bg-red-600/45 disabled:opacity-50"
            >
              Διαγραφή
            </button>
          )}
          <button
            type="submit"
            disabled={saveDisabled}
            className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2.5 text-sm font-bold text-emerald-100 disabled:opacity-50"
          >
            {saving ? 'Αποθήκευση...' : typesLoading ? 'Φόρτωση...' : 'Αποθήκευση'}
          </button>
        </div>
      </form>

      {loanDeleteOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/25 backdrop-blur-none"
            aria-label="Κλείσιμο διαλόγου διαγραφής"
            onClick={() => !deleting && setLoanDeleteOpen(false)}
            disabled={deleting}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-loan-title"
            className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
            style={deletePanelStyle}
          >
            <div className={deleteDragHandleClassName} {...deleteDragHandleProps}>
            <h3 id="delete-loan-title" className="text-lg font-bold text-white">
              Διαγραφή Δόσης Δανείου
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Επιλέξτε αν θέλετε να διαγραφεί μόνο η τρέχουσα δόση ή ολόκληρη η σειρά.
            </p>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleDeleteCurrentInstallment}
                disabled={deleting}
                className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-sm font-bold text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
              >
                {deleting ? 'Διαγραφή...' : 'Διαγραφή τρέχουσας δόσης'}
              </button>
              <button
                type="button"
                onClick={handleDeleteLoanSeries}
                disabled={deleting}
                className="rounded-xl border border-red-500/50 bg-red-600/30 px-4 py-2.5 text-sm font-bold text-red-100 hover:bg-red-600/45 disabled:opacity-50"
              >
                {deleting ? 'Διαγραφή...' : 'Διαγραφή όλης της σειράς'}
              </button>
              <button
                type="button"
                onClick={() => setLoanDeleteOpen(false)}
                disabled={deleting}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                Ακύρωση
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
