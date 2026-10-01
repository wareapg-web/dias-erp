import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { diasClient, formatSupabaseError } from '../lib/supabase'
import {
  movementFormFromRow,
  parseMovementAmount,
  extractLedgerAmount,
  isBareEuroText,
  normalizeEntryDate,
  mergeInvoiceBreakdownDescription,
  buildPartialPaymentDescription,
  settlementTypeStub,
  settlementTypeIdsForCategory,
  isSettlementCreditTypeId,
  isSettlementFullTypeId,
  settlementCategoryFromTypeId,
} from '../lib/techLedger'
import { fromElInputValue, parseElNumber, toElInputDisplay } from '../lib/numberFormat'
import { formatEuro } from '../lib/payrollAnalysis'
import { parseToIsoDate, greekCapsLabel } from '../lib/greekDate'
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
  paymentCreditColumns,
  paymentTypeCodeFromDescription,
  payrollTypeCodeFromDescription,
  resolveTransactionTypeFromLedgerRow,
  shouldPostAsPayment,
  sideFromLedgerBucket,
} from '../lib/transactionTypes'
import DarkSelect from './DarkSelect'
import GreekDateInput from './GreekDateInput'
import { useDraggableModal, MODAL_POS_KEYS } from '../lib/useDraggableModal'
import { loadModalSize, saveModalSize, MOVEMENT_MODAL_SIZE_KEY } from '../lib/modalSize'
import { getLedgerCategoryPolicy } from '../lib/personnel'
import {
  LOAN_DISBURSEMENT_TYPE_ID,
  LOAN_INSTALLMENT_TYPE_ID,
  isLoanInstallmentRow,
  loanSeriesNotesKey,
} from '../lib/loanUi'

const INVOICE_SETTLEMENT_TYPE_ID = 93
const INVOICE_PARTIAL_PAYMENT_TYPE_ID = 96
const MOVEMENT_MODAL_MIN_W = 560

function isInvoiceTimCreditType(typeOrId) {
  const id = Number(typeOrId)
  return id === INVOICE_SETTLEMENT_TYPE_ID || id === INVOICE_PARTIAL_PAYMENT_TYPE_ID
}

function sideIsCredit(side) {
  return String(side || '').toUpperCase() === 'CREDIT'
}
const MOVEMENT_MODAL_MIN_H = 380

function defaultMovementModalSize() {
  if (typeof window === 'undefined') return { width: 680, height: 560 }
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    width: Math.min(700, Math.max(MOVEMENT_MODAL_MIN_W, vw - 32)),
    height: Math.min(Math.round(vh * 0.82), Math.max(MOVEMENT_MODAL_MIN_H, vh - 48)),
  }
}

/** Εμφάνιση ποσού · 0,00 € μόνο όταν ΔΕΝ είναι focused (ώστε να μην «κολλάει» στο σβήσιμο). */
function amountFieldDisplay(stored, focused) {
  const d = toElInputDisplay(stored)
  if (focused) return d
  if (d === '' || d == null) return '0,00 €'
  return d
}

function sanitizeAmountRaw(raw) {
  return fromElInputValue(String(raw ?? '').replace(/€/gi, ''))
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** Gross ↔ Net με συντελεστή παρακράτησης (π.χ. 20% → 0.8). */
function netToGross(net, factor) {
  const n = Number(net)
  if (!Number.isFinite(n) || !(factor > 0)) return ''
  return String(round2(n / factor))
}

function grossToNet(gross, factor) {
  const g = Number(gross)
  if (!Number.isFinite(g) || !(factor > 0)) return ''
  return String(round2(g * factor))
}

const MANUAL_BONUS_TYPE_ID = 5

/** Δώρα μετρητά — σε Χρέωση εμφανίζονται σε κάθε Κατηγορία (Μισθός/Λοιπά/Τιμολόγιο). */
const CROSS_CATEGORY_DEBIT_GIFT_IDS = new Set([11, 12])

/** Ad-hoc Bonus + δώρα — cross-category χρεώσεις. */
const CROSS_CATEGORY_DEBIT_IDS = new Set([MANUAL_BONUS_TYPE_ID, ...CROSS_CATEGORY_DEBIT_GIFT_IDS])

/** Τύποι που δημιουργούνται αλλού (settlement / LoanModal / αποδοχές) — όχι χειροκίνητα. */
const EXCLUDED_MANUAL_TYPE_IDS = new Set([
  1, 2, 3, 4, 10, 14, 24, 26, 91, 92, 93, 94, 95, 96, 97, 98,
  // σταθερές αποδοχές / auto-transfer
  21, // Επίδομα Οδηγού
  23, // Λογιστής
  41, // Bonus +
])

/** Λεκτικό backup για μελλοντικά IDs με ίδια σημασία. */
const EXCLUDED_MANUAL_LABEL_RE =
  /εξόφλησ|εξοφλησ|πληρωμή\s*τιμολογ|πληρωμη\s*τιμολογ|πληρωμή\s*μισθ|πληρωμη\s*μισθ|πληρωμή\s*λοιπ|πληρωμη\s*λοιπ|προκαταβολ|δάνειο|δανειο|δόση|δοση|εκταμίευσ|εκταμιευσ|ticket|ασφάλισ|ασφαλισ|bonus\s*\+|υπόλοιπο\s*μισθ|υπολοιπο\s*μισθ|επίδομα\s*οδηγ|επιδομα\s*οδηγ|λογιστ/i

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

/** Κατηγορία UI για cross-category τύπους (Bonus/δώρα) · αλλιώς native ledger_group. */
function effectiveLedgerGroup(type, uiCategory) {
  const cat = normalizeCategory(uiCategory)
  if (type && CROSS_CATEGORY_DEBIT_IDS.has(Number(type.id))) return cat
  if (!type) return cat || 'OTHER'
  return type.ledger_group || (typeIsSalary(type) ? 'SALARY' : 'OTHER')
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
 * Τιμολόγιο: πίστωση → 93 εξόφληση / 96 μερική πληρωμή · χρέωση → δεδουλευμένα.
 * Δώρα 11/12: σε Χρέωση → όλες οι κατηγορίες (και Τιμολόγιο → invoice_amount).
 */
function filterTypesForCategorySide(types, category, side) {
  const cat = normalizeCategory(category)
  const credit = String(side || '').toUpperCase() === 'CREDIT'
  const list = Array.isArray(types) ? types : []

  return list.filter((t) => {
    const id = Number(t.id)
    if (HIDDEN_LEDGER_TYPE_IDS.has(id)) return false

    // Bonus + δώρα: bypass ledger_group σε κάθε Κατηγορία (μόνο Χρέωση)
    if (!credit && CROSS_CATEGORY_DEBIT_IDS.has(id)) return true

    if (cat === 'INVOICE') {
      if (credit) return isInvoiceTimCreditType(id)
      if (isInvoiceTimCreditType(id)) return false
      if (SALARY_CREDIT_IDS.has(id) || OTHER_CREDIT_IDS.has(id)) return false
      return true
    }

    if (cat === 'SALARY') {
      if (!typeIsSalary(t)) return false
      if (credit) return SALARY_CREDIT_IDS.has(id)
      return SALARY_DEBIT_IDS.has(id) || !SALARY_CREDIT_IDS.has(id)
    }

    // OTHER — αποκλείουμε 93/96 (ανήκουν στο Τιμολόγιο)
    if (typeIsSalary(t) || isInvoiceTimCreditType(id)) return false
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
  const kind = settlementCategoryFromTypeId(allow)
  const allowPair = kind
    ? settlementTypeIdsForCategory(
        kind === 'salary' ? 'SALARY' : kind === 'invoice' ? 'INVOICE' : 'OTHER'
      )
    : null
  return (types || []).filter((t) => {
    const id = Number(t.id)
    if (allow != null && id === allow) return true
    if (allowPair && (id === allowPair.full || id === allowPair.partial)) return true
    return !isExcludedManualType(t)
  })
}

/** Bonus πρώτο · δώρα 11/12 στο κάτω μέρος · τα υπόλοιπα κατά sort_order. */
function sortMovementTypeOptions(types) {
  return [...(types || [])].sort((a, b) => {
    const aId = Number(a.id)
    const bId = Number(b.id)
    const aBonus = aId === MANUAL_BONUS_TYPE_ID ? 0 : 1
    const bBonus = bId === MANUAL_BONUS_TYPE_ID ? 0 : 1
    if (aBonus !== bBonus) return aBonus - bBonus
    const aGift = CROSS_CATEGORY_DEBIT_GIFT_IDS.has(aId) ? 1 : 0
    const bGift = CROSS_CATEGORY_DEBIT_GIFT_IDS.has(bId) ? 1 : 0
    if (aGift !== bGift) return aGift - bGift
    const orderA = Number(a.sort_order ?? 0)
    const orderB = Number(b.sort_order ?? 0)
    if (orderA !== orderB) return orderA - orderB
    return aId - bId
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
  /** Υπόλοιπο κατηγορίας (net) · για διάκριση εξόφλησης vs μερικής πληρωμής ΤΙΜ. */
  settlementBalance = null,
  presetMonth = null,
  presetYear = null,
  hasInvoice = false,
  /** Ιστορικοί όροι μήνα — από resolveInvoiceTermsForMonth. */
  invoiceGrossUp = true,
  taxPercent = 20,
  techIsTemporary = false,
  onClose,
  onSaved,
  error: externalError = null,
}) {
  const [form, setForm] = useState(() => movementFormFromRow(null))
  /** UI-only · μικτή αξία τιμολογίου · δεν αποθηκεύεται. */
  const [grossAmountDisplay, setGrossAmountDisplay] = useState('')
  const [netAmountFocused, setNetAmountFocused] = useState(false)
  const [grossAmountFocused, setGrossAmountFocused] = useState(false)
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
  const resizeRef = useRef(null)
  const modalSizeRef = useRef(null)
  const [modalSize, setModalSize] = useState(() =>
    loadModalSize(MOVEMENT_MODAL_SIZE_KEY, defaultMovementModalSize)
  )
  modalSizeRef.current = modalSize
  const [deleting, setDeleting] = useState(false)
  /** Edit τιμολογίου χωρίς hasInvoice: κράτα την επιλογή Κατηγορίας σε όλο το session. */
  const [allowInvoiceCategory, setAllowInvoiceCategory] = useState(false)

  useEffect(() => {
    if (!open) return
    setModalSize(loadModalSize(MOVEMENT_MODAL_SIZE_KEY, defaultMovementModalSize))
  }, [open])

  useEffect(() => {
    saveModalSize(MOVEMENT_MODAL_SIZE_KEY, modalSize)
  }, [modalSize])

  useEffect(() => {
    const onMove = (e) => {
      const d = resizeRef.current
      if (!d) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      const vw = window.innerWidth
      const vh = window.innerHeight
      let { width, height } = d.orig
      const edge = d.edge
      if (edge.includes('e')) width = d.orig.width + dx
      if (edge.includes('s')) height = d.orig.height + dy
      if (edge.includes('w')) width = d.orig.width - dx
      if (edge.includes('n')) height = d.orig.height - dy
      width = Math.min(Math.max(width, MOVEMENT_MODAL_MIN_W), vw - 24)
      height = Math.min(Math.max(height, MOVEMENT_MODAL_MIN_H), vh - 24)
      const next = { width, height }
      setModalSize(next)
      saveModalSize(MOVEMENT_MODAL_SIZE_KEY, next)
    }
    const onUp = () => {
      if (!resizeRef.current) return
      resizeRef.current = null
      saveModalSize(MOVEMENT_MODAL_SIZE_KEY, modalSizeRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const startResize = useCallback(
    (edge) => (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        orig: { ...modalSize },
      }
    },
    [modalSize]
  )

  const resizeHandle = (edge, cursor, extra = '') => (
    <div
      role="presentation"
      onPointerDown={startResize(edge)}
      className={`absolute z-30 ${extra}`}
      style={{ cursor }}
    />
  )

  const isEdit = Boolean(selectedRowData?.id)
  const rowSource = selectedRowData?.source || 'PAYROLL'
  const showLoanDelete = isEdit && isLoanInstallmentRow(selectedRowData)

  const uiCategory = normalizeCategory(form.ledger_group)

  const showInvoiceCategory = hasInvoice === true || allowInvoiceCategory
  const categoryPolicy = useMemo(() => getLedgerCategoryPolicy(tech), [tech])

  const pct = Number(taxPercent)
  const safeTaxPercent = Number.isFinite(pct) && pct > 0 ? pct : 20
  const grossUpFactor = 1 - safeTaxPercent / 100
  const isInvoiceTimCreditSettlement =
    isInvoiceTimCreditType(selectedTypeId ?? presetTypeId) &&
    sideIsCredit(form.side || presetSide) &&
    techIsTemporary !== true &&
    categoryPolicy.temporary !== true
  const showInvoiceGrossDual =
    (uiCategory === 'INVOICE' || isInvoiceTimCreditSettlement) &&
    techIsTemporary !== true &&
    categoryPolicy.temporary !== true &&
    invoiceGrossUp !== false &&
    grossUpFactor > 0 &&
    grossUpFactor < 1

  const categoryOptions = useMemo(() => {
    const labelByValue = new Map(
      [...CATEGORY_WITH_INVOICE, ...CATEGORY_BASE].map((o) => [o.value, o])
    )
    let values = [...categoryPolicy.allowedCategories]
    // Μόνιμος + edit παλιού τιμολογίου χωρίς flag: κράτα INVOICE στη λίστα
    if (!categoryPolicy.temporary && showInvoiceCategory && !values.includes('INVOICE')) {
      values = ['INVOICE', ...values]
    }
    // Ιστορική εγγραφή με απαγορευμένη πλέον κατηγορία: εμφάνιση (locked) χωρίς crash
    if (isEdit && uiCategory && !values.includes(uiCategory)) {
      values = [...values, uiCategory]
    }
    return values.map((v) => labelByValue.get(v)).filter(Boolean)
  }, [categoryPolicy, showInvoiceCategory, isEdit, uiCategory])

  const categorySelectLocked =
    (categoryPolicy.temporary &&
      (categoryPolicy.allowedCategories.length <= 1 ||
        (isEdit && !categoryPolicy.allowedCategories.includes(uiCategory)))) ||
    (isInvoiceTimCreditSettlement && !isEdit)

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

  const applyTypeKeepDrivers = (t, category, side) => {
    if (!t) return
    const cat = normalizeCategory(category)
    const salary = CROSS_CATEGORY_DEBIT_IDS.has(Number(t.id))
      ? cat === 'SALARY'
      : typeIsSalary(t)
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

        const list = [...(data || [])]
        // Stubs αν λείπουν εξόφληση/πληρωμή τύποι από DB
        for (const id of [91, 92, 93, 96, 97, 98]) {
          if (!list.some((t) => Number(t.id) === id)) {
            const stub = settlementTypeStub(id)
            if (stub) list.push(stub)
          }
        }
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

        const policy = getLedgerCategoryPolicy(tech)
        const timCreditSettlement =
          isInvoiceTimCreditType(presetTypeId ?? match?.id ?? selectedRowData?.type_id ?? selectedRowData?.ept_id) &&
          sideIsCredit(side) &&
          (!selectedRowData ||
            Number(selectedRowData.invoice_credit) > 0 ||
            bucket === 'invoice_credit' ||
            presetPostToInvoice === true)
        const category = (() => {
          // Νέα Εισαγωγή (χωρίς edit / χωρίς preset τύπου): default από ledger policy
          let cat
          if (!selectedRowData && presetTypeId == null) {
            if (policy.temporary) cat = policy.defaultCategory
            else if (hasInvoice === true) cat = 'INVOICE'
            else {
              cat = resolveUiCategory({
                postToInvoice: postInvoiceFlag,
                ledgerGroup: base.ledger_group,
                type: match,
              })
            }
          } else {
            cat = resolveUiCategory({
              postToInvoice: postInvoiceFlag || timCreditSettlement,
              ledgerGroup: base.ledger_group,
              type: match,
            })
          }
          // Εξόφληση ΤΙΜ (93): πάντα Τιμολόγιο — αλλιώς πέφτει σε Μισθό/Λοιπά και χάνεται ο οδηγός
          if (timCreditSettlement) cat = 'INVOICE'
          // Νέα κίνηση έκτακτου: ποτέ απαγορευμένη κατηγορία στο dropdown
          if (policy.temporary && !selectedRowData && !policy.allowedCategories.includes(cat)) {
            cat = policy.defaultCategory
          }
          return cat
        })()

        if (hasInvoice === true || category === 'INVOICE' || policy.allowInvoice) {
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

        const nextAmount =
          !selectedRowData && presetAmount != null && presetAmount !== ''
            ? String(presetAmount)
            : base.amount
        const safePctInit = Number(taxPercent) > 0 ? Number(taxPercent) : 20
        const factorInit = 1 - safePctInit / 100
        let nextDescription =
          !selectedRowData && presetDescription
            ? presetDescription
            : isBareEuroText(base.description)
              ? ''
              : base.description
        const dualOk =
          (category === 'INVOICE' || timCreditSettlement) &&
          techIsTemporary !== true &&
          policy.temporary !== true &&
          invoiceGrossUp !== false

        const settlementKind =
          settlementCategoryFromTypeId(chosen?.id ?? presetTypeId) ||
          (category === 'SALARY'
            ? 'salary'
            : category === 'INVOICE'
              ? 'invoice'
              : category === 'OTHER'
                ? 'other'
                : null)
        const settlementIds = settlementKind
          ? settlementTypeIdsForCategory(
              settlementKind === 'salary'
                ? 'SALARY'
                : settlementKind === 'invoice'
                  ? 'INVOICE'
                  : 'OTHER'
            )
          : null
        const isSettlementCreditFlow =
          !selectedRowData &&
          sideIsCredit(side) &&
          settlementIds != null &&
          (isSettlementCreditTypeId(chosen?.id ?? presetTypeId) ||
            settlementBalance != null)

        if (isSettlementCreditFlow && settlementIds) {
          const netN = parseElNumber(nextAmount)
          const balance = Number(settlementBalance)
          const hasBalance = Number.isFinite(balance) && balance > 0.005
          const clears =
            netN != null &&
            netN > 0 &&
            ((hasBalance && netN >= balance - 0.005) ||
              (!hasBalance && isSettlementFullTypeId(chosen?.id ?? presetTypeId)))
          const wantId = clears ? settlementIds.full : settlementIds.partial
          if (Number(chosen?.id) !== wantId) {
            const swapped =
              list.find((t) => Number(t.id) === wantId) || settlementTypeStub(wantId)
            if (swapped) chosen = swapped
          }
          if (netN != null && netN > 0) {
            if (clears && settlementKind === 'invoice' && dualOk && factorInit > 0 && factorInit < 1) {
              nextDescription = mergeInvoiceBreakdownDescription(
                nextDescription,
                netN,
                safePctInit
              )
            } else if (clears && settlementKind === 'invoice') {
              if (!nextDescription || isBareEuroText(nextDescription)) {
                nextDescription = mergeInvoiceBreakdownDescription(
                  null,
                  netN,
                  safePctInit
                )
              }
            } else if (clears) {
              // πλήρης εξόφληση Μ/Λ — χωρίς ειδικό breakdown
              if (!nextDescription || isBareEuroText(nextDescription)) {
                nextDescription = ''
              }
            } else {
              const displayAmt =
                settlementKind === 'invoice' && dualOk && factorInit > 0 && factorInit < 1
                  ? netN / factorInit
                  : netN
              nextDescription = buildPartialPaymentDescription(displayAmt)
            }
          } else if (!isSettlementFullTypeId(chosen?.id ?? presetTypeId)) {
            nextDescription = ''
          }
        }

        setSelectedTypeId(chosen?.id ?? null)
        setForm({
          ...base,
          type: chosen?.description || base.type,
          description: nextDescription,
          amount: nextAmount,
          is_salary_type: typeIsSalary(chosen),
          ledger_group: category,
          side,
          post_to_invoice: category === 'INVOICE',
        })

        // Dual UI: net από preset · gross = net / factor (μόνο μόνιμοι + προσαύξηση)
        if (dualOk && factorInit > 0 && factorInit < 1) {
          const netN = parseElNumber(nextAmount)
          setGrossAmountDisplay(
            netN != null && netN !== 0 ? netToGross(netN, factorInit) : ''
          )
        } else {
          setGrossAmountDisplay('')
        }
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
  }, [
    open,
    selectedRowData,
    presetTypeId,
    presetSide,
    presetDescription,
    presetAmount,
    presetPostToInvoice,
    hasInvoice,
    tech,
    invoiceGrossUp,
    taxPercent,
    techIsTemporary,
    settlementBalance,
  ])

  if (!open) return null

  const patch = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const resolveSettlementPaymentPresentation = (netAmount, list = types) => {
    const net = Number(netAmount)
    const hasNet = Number.isFinite(net) && net > 0
    const balance = Number(settlementBalance)
    const hasBalance = Number.isFinite(balance) && balance > 0.005
    const cat = normalizeCategory(form.ledger_group)
    const kindFromType = settlementCategoryFromTypeId(selectedTypeId ?? presetTypeId)
    const kind =
      kindFromType ||
      (cat === 'SALARY' ? 'salary' : cat === 'INVOICE' ? 'invoice' : cat === 'OTHER' ? 'other' : null)
    const ids = kind
      ? settlementTypeIdsForCategory(
          kind === 'salary' ? 'SALARY' : kind === 'invoice' ? 'INVOICE' : 'OTHER'
        )
      : null
    if (!ids) return { clears: false, targetId: null, targetType: null, description: '', kind: null }

    const clears =
      hasNet &&
      ((hasBalance && net >= balance - 0.005) ||
        (!hasBalance && isSettlementFullTypeId(selectedTypeId ?? presetTypeId)))

    const targetId = clears ? ids.full : ids.partial
    const targetType =
      (list || []).find((t) => Number(t.id) === targetId) ||
      settlementTypeStub(targetId)

    let description = ''
    if (hasNet) {
      if (clears && kind === 'invoice') {
        description =
          mergeInvoiceBreakdownDescription(
            null,
            net,
            Number(taxPercent) > 0 ? Number(taxPercent) : 20
          ) || ''
      } else if (!clears) {
        const factor = grossUpFactor > 0 && grossUpFactor < 1 ? grossUpFactor : 1
        const displayAmt =
          kind === 'invoice' && showInvoiceGrossDual && factor > 0 && factor < 1
            ? net / factor
            : net
        description = buildPartialPaymentDescription(displayAmt)
      }
    }

    return { clears, targetId, targetType, description, kind }
  }

  const applySettlementPaymentPresentation = (netRaw) => {
    if (isEdit) return
    if (!sideIsCredit(form.side)) return
    const cat = normalizeCategory(form.ledger_group)
    const typeId = selectedTypeId ?? presetTypeId
    if (
      !isSettlementCreditTypeId(typeId) &&
      cat !== 'SALARY' &&
      cat !== 'OTHER' &&
      cat !== 'INVOICE'
    ) {
      return
    }
    // Μόνο όταν ήρθε από ΕΞΟΦΛΗΣΗ/ΠΛΗΡΩΜΗ (υπάρχει υπόλοιπο) ή είναι ήδη settlement type
    if (settlementBalance == null && !isSettlementCreditTypeId(typeId)) return

    const net = parseElNumber(netRaw)
    const { targetId, targetType, description, kind } =
      resolveSettlementPaymentPresentation(net)
    if (!targetType) return
    const ledgerGroup =
      kind === 'salary' ? 'SALARY' : kind === 'invoice' ? 'INVOICE' : 'OTHER'
    if (Number(selectedTypeId) !== targetId) {
      setSelectedTypeId(targetId)
      setForm((prev) => ({
        ...prev,
        type: targetType.description,
        description,
        ledger_group: ledgerGroup,
        post_to_invoice: kind === 'invoice',
      }))
      return
    }
    setForm((prev) => ({ ...prev, description }))
  }

  const patchNetAmount = (raw) => {
    const next = sanitizeAmountRaw(raw)
    patch('amount', next)
    if (!showInvoiceGrossDual) {
      applySettlementPaymentPresentation(next)
      return
    }
    const n = parseElNumber(next)
    if (n == null) {
      if (!String(next || '').trim()) setGrossAmountDisplay('')
      applySettlementPaymentPresentation(next)
      return
    }
    setGrossAmountDisplay(netToGross(n, grossUpFactor))
    applySettlementPaymentPresentation(next)
  }

  const patchGrossAmount = (raw) => {
    const next = sanitizeAmountRaw(raw)
    setGrossAmountDisplay(next)
    const g = parseElNumber(next)
    if (g == null) {
      if (!String(next || '').trim()) patch('amount', '')
      applySettlementPaymentPresentation('')
      return
    }
    const netStr = grossToNet(g, grossUpFactor)
    patch('amount', netStr)
    applySettlementPaymentPresentation(netStr)
  }

  const handleCategoryChange = (value) => {
    if (categorySelectLocked) return
    const category = normalizeCategory(value)
    if (
      categoryPolicy.temporary &&
      !categoryPolicy.allowedCategories.includes(category)
    ) {
      return
    }
    const side = form.side || 'DEBIT'
    const nextFiltered = getFilteredMovementTypes(types, category, side, exceptionTypeId)
    setForm((prev) => ({
      ...prev,
      ledger_group: category,
      post_to_invoice: category === 'INVOICE',
    }))
    // Sync gross όταν μπαίνει σε Τιμολόγιο με dual mode
    const dualOk =
      category === 'INVOICE' &&
      techIsTemporary !== true &&
      categoryPolicy.temporary !== true &&
      invoiceGrossUp !== false &&
      grossUpFactor > 0 &&
      grossUpFactor < 1
    if (dualOk) {
      const n = parseElNumber(form.amount)
      setGrossAmountDisplay(n != null ? netToGross(n, grossUpFactor) : '')
    } else {
      setGrossAmountDisplay('')
    }
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

    // Νέες κινήσεις: αυστηρό φίλτρο κατηγορίας για έκτακτους (ιστορικά edits επιτρέπονται)
    if (!isEdit && categoryPolicy.temporary) {
      const cat = normalizeCategory(form.ledger_group)
      if (!categoryPolicy.allowedCategories.includes(cat)) {
        const msg =
          categoryPolicy.allowInvoice
            ? 'Για έκτακτους με τιμολόγιο επιτρέπεται μόνο η κατηγορία Τιμολόγιο'
            : 'Για έκτακτους χωρίς τιμολόγιο επιτρέπεται μόνο η κατηγορία Λοιπά'
        setSaveError(msg)
        toast.error(msg)
        return
      }
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

    let effectiveType = selectedType
    const effectiveGroup = effectiveLedgerGroup(effectiveType, form.ledger_group)
    const isSalary = isSalaryLedgerGroup(effectiveGroup)
    const side = form.side || 'DEBIT'
    const postAsPayment = shouldPostAsPayment(side)
    // Κατηγορία=Τιμολόγιο → invoice στήλες (χωρίς checkbox)
    const invoiceFlag = normalizeCategory(form.ledger_group) === 'INVOICE'
    const invoiceAmount = invoiceFlag && !postAsPayment ? amount : 0
    const rawDescription = form.description?.trim() || ''
    let description =
      rawDescription && !isBareEuroText(rawDescription) ? rawDescription : null

    // Πίστωση εξόφλησης/πληρωμής: πλήρης → 91/92/93 · μερική → 97/98/96 + «πληρωμή X»
    const typeId = Number(effectiveType.id)
    const settlementKind =
      settlementCategoryFromTypeId(typeId) ||
      (invoiceFlag
        ? 'invoice'
        : isSalaryLedgerGroup(effectiveGroup)
          ? 'salary'
          : side === 'CREDIT' && isSettlementCreditTypeId(typeId)
            ? 'other'
            : null)
    const settlementIds = settlementKind
      ? settlementTypeIdsForCategory(
          settlementKind === 'salary'
            ? 'SALARY'
            : settlementKind === 'invoice'
              ? 'INVOICE'
              : 'OTHER'
        )
      : null
    const isSettlementCredit =
      side === 'CREDIT' &&
      settlementIds != null &&
      (isSettlementCreditTypeId(typeId) ||
        invoiceFlag ||
        settlementBalance != null) &&
      typeId !== LOAN_INSTALLMENT_TYPE_ID &&
      typeId !== LOAN_DISBURSEMENT_TYPE_ID

    if (isSettlementCredit && amount > 0) {
      const balance = Number(settlementBalance)
      const hasBalance = Number.isFinite(balance) && balance > 0.005
      const clears = hasBalance
        ? amount >= balance - 0.005
        : isSettlementFullTypeId(typeId) &&
          !/^πληρωμ[ήη]\b/i.test(String(form.description || ''))

      if (!isEdit && !clears) {
        const realPartial = types.find(
          (t) => Number(t.id) === settlementIds.partial && t.__stub !== true
        )
        effectiveType = realPartial || {
          id: settlementIds.full,
          description:
            settlementKind === 'salary'
              ? 'Πληρωμή Μισθού'
              : settlementKind === 'invoice'
                ? 'Πληρωμή Τιμολογίου'
                : 'Πληρωμή Λοιπών',
          ledger_group:
            settlementKind === 'salary' ? 'SALARY' : 'OTHER',
          is_for_sum: false,
        }
      }
      if (!isEdit && clears) {
        const realFull = types.find(
          (t) => Number(t.id) === settlementIds.full && t.__stub !== true
        )
        effectiveType =
          realFull || settlementTypeStub(settlementIds.full) || effectiveType
      }

      const useGrossUp =
        settlementKind === 'invoice' &&
        invoiceGrossUp !== false &&
        techIsTemporary !== true &&
        categoryPolicy.temporary !== true &&
        grossUpFactor > 0 &&
        grossUpFactor < 1

      if (clears) {
        if (useGrossUp) {
          description = mergeInvoiceBreakdownDescription(
            null,
            amount,
            Number(taxPercent) > 0 ? Number(taxPercent) : 20
          )
        }
      } else {
        const displayAmt = useGrossUp ? amount / grossUpFactor : amount
        description = buildPartialPaymentDescription(displayAmt)
      }
    }

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
            effectiveType.description,
            effectiveGroup
          )
          const credits = paymentCreditColumns({
            amount,
            paymentType,
            postToInvoice: invoiceFlag,
            typeId: effectiveType.id,
            ledgerGroup: effectiveGroup,
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
              type_id: Number(effectiveType.id) || null,
            })
            .eq('id', selectedRowData.id)
          if (error) throw error
        } else {
          const { error } = await diasClient
            .from('payroll_entries')
            .update({
              reference_date: entryDateIso,
              type_code: payrollTypeCodeFromDescription(effectiveType.description),
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
          effectiveType.description,
          effectiveGroup
        )
        const credits = paymentCreditColumns({
          amount,
          paymentType,
          postToInvoice: invoiceFlag,
          typeId: effectiveType.id,
          ledgerGroup: effectiveGroup,
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
          type_id: Number(effectiveType.id) || null,
        })
        if (error) throw error
      } else {
        const { error } = await diasClient.from('payroll_entries').insert({
          tech_id: String(tech.id),
          reference_date: entryDateIso,
          type_code: payrollTypeCodeFromDescription(effectiveType.description),
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/20 backdrop-blur-none"
        aria-hidden
      />
      <form
        onSubmit={handleSave}
        className="relative my-auto flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
        style={{
          width: modalSize.width,
          height: modalSize.height,
          maxWidth: 'calc(100vw - 1.5rem)',
          maxHeight: 'calc(100vh - 1.5rem)',
          ...panelStyle,
        }}
      >
        {resizeHandle('n', 'ns-resize', 'left-2 right-2 top-0 h-2')}
        {resizeHandle('s', 'ns-resize', 'left-2 right-2 bottom-0 h-2')}
        {resizeHandle('e', 'ew-resize', 'top-2 bottom-2 right-0 w-2')}
        {resizeHandle('w', 'ew-resize', 'top-2 bottom-2 left-0 w-2')}
        {resizeHandle('nw', 'nwse-resize', 'left-0 top-0 h-3 w-3')}
        {resizeHandle('ne', 'nesw-resize', 'right-0 top-0 h-3 w-3')}
        {resizeHandle('sw', 'nesw-resize', 'bottom-0 left-0 h-3 w-3')}
        {resizeHandle('se', 'nwse-resize', 'bottom-0 right-0 h-4 w-4')}
        <div
          className={`flex shrink-0 items-start justify-between gap-2 border-b border-white/10 px-4 pt-3 pb-2 ${dragHandleClassName}`}
          {...dragHandleProps}
        >
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Καρτέλα
            </p>
            <h3 className="text-base font-bold text-white">
              {isEdit ? 'Επεξεργασία Κίνησης' : 'Κίνηση'}
            </h3>
            <p className="text-[11px] text-slate-400">
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
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5">
        <div className="space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Στοιχεία</p>

          {(typesError || typesLoading) && (
            <div
              className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                typesError
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                  : 'border-white/10 bg-white/5 text-slate-400'
              }`}
            >
              {typesError || 'Φόρτωση τύπων από Supabase...'}
            </div>
          )}

          <fieldset disabled={formDisabled} className="space-y-2 disabled:opacity-60">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {greekCapsLabel('Ημερομηνία')}
              </label>
              <GreekDateInput
                value={form.entry_date || ''}
                onChange={(iso) => patch('entry_date', iso)}
                withPicker
                className="mt-0.5 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {greekCapsLabel('Κατηγορία')}
                </label>
                <DarkSelect
                  value={uiCategory}
                  onChange={(v) => handleCategoryChange(v)}
                  className="mt-0.5 w-full"
                  options={categoryOptions}
                  disabled={categorySelectLocked}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {greekCapsLabel('Κατεύθυνση')}
                </label>
                <DarkSelect
                  value={form.side || 'DEBIT'}
                  onChange={() => {}}
                  className="mt-0.5 w-full"
                  options={SIDE_OPTIONS.filter(
                    (o) => o.value === String(form.side || 'DEBIT').toUpperCase()
                  )}
                  disabled
                />
              </div>
            </div>

            {!categoryPolicy.temporary ? (
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {greekCapsLabel('Τύπος')}
                </label>
                <DarkSelect
                  value={noAvailableTypes ? '' : (selectedTypeId ?? '')}
                  onChange={(v) => handleTypeChange(v)}
                  className="mt-0.5 w-full"
                  options={typeSelectOptions}
                  disabled={typeSelectLocked || noAvailableTypes}
                  placeholder={EMPTY_TYPE_PLACEHOLDER}
                />
              </div>
            ) : null}

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {greekCapsLabel('Περιγραφή')}
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder="π.χ. 20.00 ώρα/ες x 15.00 €"
                className="mt-0.5 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-600"
              />
            </div>

            {showInvoiceGrossDual ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/[0.07] px-2 py-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-cyan-100">
                      {greekCapsLabel('Καθαρό Ποσό')}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amountFieldDisplay(form.amount, netAmountFocused)}
                      onChange={(e) => patchNetAmount(e.target.value)}
                      onFocus={(e) => {
                        setNetAmountFocused(true)
                        const n = parseElNumber(sanitizeAmountRaw(e.target.value))
                        if (n == null || n === 0) e.target.select()
                      }}
                      onBlur={() => setNetAmountFocused(false)}
                      className="mt-0.5 w-full rounded-lg border border-cyan-400/35 bg-slate-950/70 px-2.5 py-1.5 font-mono text-base font-bold tabular-nums text-white outline-none focus:border-cyan-300/55 focus:ring-1 focus:ring-cyan-400/20"
                    />
                  </div>
                  <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2 py-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-amber-100">
                      {greekCapsLabel(`Προσαύξηση ${safeTaxPercent}%`)}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      required
                      value={amountFieldDisplay(grossAmountDisplay, grossAmountFocused)}
                      onChange={(e) => patchGrossAmount(e.target.value)}
                      onFocus={(e) => {
                        setGrossAmountFocused(true)
                        const n = parseElNumber(sanitizeAmountRaw(e.target.value))
                        if (n == null || n === 0) e.target.select()
                      }}
                      onBlur={() => setGrossAmountFocused(false)}
                      className="mt-0.5 w-full rounded-lg border border-amber-500/40 bg-slate-950/70 px-2.5 py-1.5 font-mono text-base font-bold tabular-nums text-amber-50 outline-none focus:border-amber-300/55 focus:ring-1 focus:ring-amber-400/20"
                    />
                  </div>
                </div>
                {(() => {
                  const grossN =
                    parseElNumber(grossAmountDisplay) ??
                    (() => {
                      const n = parseElNumber(form.amount)
                      return n != null && grossUpFactor > 0 ? round2(n / grossUpFactor) : null
                    })()
                  if (grossN == null || !(grossN > 0)) return null
                  const vat = round2(grossN * 0.24)
                  const withhold = round2(grossN * (safeTaxPercent / 100))
                  const payable = round2(grossN + vat - withhold)
                  return (
                    <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 px-2.5 py-1.5 text-xs">
                      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                        {greekCapsLabel('Οδηγός πληρωμής')}
                      </p>
                      <div className="flex justify-between gap-2 py-px text-slate-300">
                        <span>Αξία Τιμολογίου</span>
                        <span className="font-mono tabular-nums">{formatEuro(grossN)}</span>
                      </div>
                      <div className="flex justify-between gap-2 py-px text-slate-300">
                        <span>ΦΠΑ 24%</span>
                        <span className="font-mono tabular-nums">+ {formatEuro(vat)}</span>
                      </div>
                      <div className="flex justify-between gap-2 py-px text-slate-300">
                        <span>Παρακρ. Φόρου ({safeTaxPercent}%)</span>
                        <span className="font-mono tabular-nums">− {formatEuro(withhold)}</span>
                      </div>
                      <hr className="my-1 border-slate-600" />
                      <div className="flex justify-between gap-2 py-px font-bold text-slate-100">
                        <span>Πληρωτέο</span>
                        <span className="font-mono tabular-nums">{formatEuro(payable)}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            ) : (
              <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/[0.07] px-2 py-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-cyan-100">
                  {greekCapsLabel('Ποσό (€)')}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  value={amountFieldDisplay(form.amount, netAmountFocused)}
                  onChange={(e) => patchNetAmount(e.target.value)}
                  onFocus={(e) => {
                    setNetAmountFocused(true)
                    const n = parseElNumber(sanitizeAmountRaw(e.target.value))
                    if (n == null || n === 0) e.target.select()
                  }}
                  onBlur={() => setNetAmountFocused(false)}
                  className="mt-0.5 w-full rounded-lg border border-cyan-400/35 bg-slate-950/70 px-2.5 py-1.5 font-mono text-base font-bold tabular-nums text-white outline-none focus:border-cyan-300/55 focus:ring-1 focus:ring-cyan-400/20"
                />
              </div>
            )}

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {greekCapsLabel('Σημειώσεις')}
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => patch('notes', e.target.value)}
                rows={1}
                className="mt-0.5 w-full rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-sm text-white"
              />
            </div>
          </fieldset>
        </div>

        {displayError && (
          <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-100">
            {displayError}
          </div>
        )}
        </div>

        <div className="flex shrink-0 gap-1.5 border-t border-white/10 bg-slate-900 px-4 py-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving || deleting}
            className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-sm font-bold text-rose-100 disabled:opacity-50"
          >
            Έξοδος
          </button>
          {showLoanDelete && (
            <button
              type="button"
              onClick={() => setLoanDeleteOpen(true)}
              disabled={saving || deleting}
              className="rounded-lg border border-red-500/50 bg-red-600/30 px-3 py-1.5 text-sm font-bold text-red-100 hover:bg-red-600/45 disabled:opacity-50"
            >
              Διαγραφή
            </button>
          )}
          <button
            type="submit"
            disabled={saveDisabled}
            className="flex-1 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-1.5 text-sm font-bold text-emerald-100 disabled:opacity-50"
          >
            {saving ? 'Αποθήκευση...' : typesLoading ? 'Φόρτωση...' : 'Αποθήκευση'}
          </button>
        </div>
      </form>

      {loanDeleteOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/25 backdrop-blur-none"
            aria-hidden
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
