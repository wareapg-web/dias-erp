/**
 * APG ERP ledger mapping — EPT_COL, EPT_ID, EPT_ORDER rules.
 * Used by TechAnalysisModal template grid + MovementModal column routing.
 */

import {
  buildLedgerAmountForType,
  buildLedgerDescriptionForType,
  extractLedgerAmount,
  isBareEuroText,
  ledgerRowKey,
} from './techLedger'
import { resolveTransactionTypeFromLedgerRow } from './transactionTypes'
import {
  extractLoanInstallmentProgress,
  LOAN_INSTALLMENT_TYPE_ID,
} from './loanUi'

/** EPT_COL → ledger block */
export const EPT_COL = {
  SALARY: 1,
  OTHER: 2,
}

/** Salary block: Μισθός (debit) */
export const SALARY_DEBIT_IDS = new Set([3])

/** Salary block: Εξόφληση Μισθού (credit) */
export const SALARY_CREDIT_IDS = new Set([1, 91])

/**
 * Other block debit (Λοιπά Χρ.): ποσότητα × τιμή
 * Υπερωρίες, Αργίες, Νυχτερινά, Διανυκτέρευση, Μετρό
 */
export const OTHER_DEBIT_IDS = new Set([7, 8, 9, 22, 25])

/** Other block credit: προκαταβολές, δάνεια, ticket, εξόφληση λοιπών, κλπ. */
export const OTHER_CREDIT_IDS = new Set([2, 10, 14, 24, 92, 94, 95])

export const LEDGER_COLUMNS = [
  'salary_debit',
  'salary_credit',
  'other_debit',
  'other_credit',
  'invoice_amount',
  'invoice_credit',
]

function normalizePaymentType(paymentType) {
  if (paymentType == null) return { id: null, ledger_group: 'OTHER' }
  if (typeof paymentType === 'number' || typeof paymentType === 'string') {
    return { id: Number(paymentType), ledger_group: null }
  }
  return {
    id: paymentType.id != null ? Number(paymentType.id) : null,
    ledger_group: paymentType.ledger_group || null,
    description: paymentType.description,
    sort_order: paymentType.sort_order,
  }
}

export function eptColFromLedgerGroup(ledgerGroup) {
  return String(ledgerGroup || '').toUpperCase() === 'SALARY' ? EPT_COL.SALARY : EPT_COL.OTHER
}

export function ledgerGroupFromEptCol(eptCol) {
  return Number(eptCol) === EPT_COL.SALARY ? 'SALARY' : 'OTHER'
}

/** Types excluded from ledger grid (no template row, saved entries hidden). */
export const HIDDEN_LEDGER_TYPE_IDS = new Set([6]) // Ώρες

export function isLedgerTypeVisible(type) {
  if (!type) return false
  return !HIDDEN_LEDGER_TYPE_IDS.has(Number(type.id))
}

/** Strict ascending sort by EPT_ORDER (sort_order) then EPT_ID. */
export function sortTransactionTypes(typesArray = []) {
  return [...typesArray].sort((a, b) => {
    const orderA = Number(a?.sort_order ?? a?.EPT_ORDER ?? 0)
    const orderB = Number(b?.sort_order ?? b?.EPT_ORDER ?? 0)
    if (orderA !== orderB) return orderA - orderB
    return Number(a?.id ?? 0) - Number(b?.id ?? 0)
  })
}

/** Sorted transaction types for ledger grid (excludes hidden rows). */
export function visibleTransactionTypes(typesArray = []) {
  return sortTransactionTypes(typesArray).filter(isLedgerTypeVisible)
}

/**
 * Resolve which ledger column an amount belongs in.
 * Μισθός (id 3) → ΠΑΝΤΑ salary_debit (ποτέ αυτόματα σε τιμολόγιο).
 * Τιμολόγιο μόνο με forceInvoice === true (ρητή επιλογή στο modal).
 */
export function resolveLedgerColumn(paymentType, amount, options = {}) {
  const type = normalizePaymentType(paymentType)
  const id = type.id
  const amt = Number(amount)
  const isNegative = Number.isFinite(amt) && amt < 0
  const { forceInvoice = null } = options

  // Ρητή επιλογή «Στήλη Τιμολόγιο» στο MovementModal
  if (forceInvoice === true) return 'invoice_amount'

  // Ρητά: Υπερωρίες / Αργίες / Νυχτερινά / Μετρό / Διανυκτέρευση → Λοιπά Χρ.
  if (OTHER_DEBIT_IDS.has(id)) return 'other_debit'

  // Μισθός → ΠΑΝΤΑ Μισθός Χρ. (ανεξάρτητα από hasInvoice)
  if (SALARY_DEBIT_IDS.has(id)) return 'salary_debit'

  const inSalaryBlock =
    type.ledger_group === 'SALARY' || SALARY_CREDIT_IDS.has(id)

  if (inSalaryBlock) {
    if (SALARY_CREDIT_IDS.has(id) || isNegative) return 'salary_credit'
    return 'salary_debit'
  }

  if (OTHER_CREDIT_IDS.has(id) || isNegative) return 'other_credit'
  return 'other_debit'
}

export function resolveLedgerSide(paymentType, amount, options = {}) {
  const column = resolveLedgerColumn(paymentType, amount, options)
  if (column === 'invoice_amount') {
    const type = normalizePaymentType(paymentType)
    if (SALARY_CREDIT_IDS.has(type.id)) return 'CREDIT'
    return String(options.side || '').toUpperCase() === 'CREDIT' ? 'CREDIT' : 'DEBIT'
  }
  return column.endsWith('_credit') ? 'CREDIT' : 'DEBIT'
}

/** Distribute amount into ledger column fields (incl. invoice_amount / invoice_credit). */
export function distributeLedgerAmount(paymentType, amount, options = {}) {
  const column = resolveLedgerColumn(paymentType, amount, options)
  const abs = Math.abs(Number(amount) || 0)
  const side = resolveLedgerSide(paymentType, amount, options)
  const toInvoice = column === 'invoice_amount'
  return {
    salary_debit: column === 'salary_debit' ? abs : 0,
    salary_credit: column === 'salary_credit' ? abs : 0,
    other_debit: column === 'other_debit' ? abs : 0,
    other_credit: column === 'other_credit' ? abs : 0,
    // Χρέωση τιμολογίου (payroll) vs πίστωση (payment)
    invoice_amount: toInvoice && side !== 'CREDIT' ? abs : 0,
    invoice_credit: toInvoice && side === 'CREDIT' ? abs : 0,
  }
}

function entryAmount(entry) {
  const { amount } = extractLedgerAmount(entry)
  if (amount) return amount

  const fromDesc = parseBareEuroAmount(entry?.description)
  if (fromDesc) return fromDesc

  const fromInvoice = Number(entry?.invoice_amount) || 0
  if (fromInvoice) return fromInvoice

  const fromInvoiceCredit = Number(entry?.invoice_credit) || 0
  if (fromInvoiceCredit) return fromInvoiceCredit

  return Number(entry?.amount) || 0
}

function parseBareEuroAmount(text) {
  if (!isBareEuroText(text)) return 0
  let s = String(text || '')
    .replace(/€/g, '')
    .trim()
    .replace(/\s/g, '')
  if (!s) return 0
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** Re-apply APG column rules to a saved ledger row (from tech_ledger_view).
 * Προτεραιότητα: φυσικές στήλες του view — χωρίς remap σε λάθος συρτάρι.
 */
export function normalizeSavedEntry(entry, transactionType, options = {}) {
  const type = transactionType || {
    id: entry?.ept_id ?? entry?.type_id,
    ledger_group: entry?.ledger_group,
  }

  const fromSalaryDebit = Number(entry?.salary_debit) || 0
  const fromSalaryCredit = Number(entry?.salary_credit) || 0
  const fromOtherDebit = Number(entry?.other_debit) || 0
  const fromOtherCredit = Number(entry?.other_credit) || 0
  const fromInvoiceDebit = Number(entry?.invoice_amount) || 0
  const fromInvoiceCredit = Number(entry?.invoice_credit) || 0

  const hasPhysicalColumns =
    fromSalaryDebit !== 0 ||
    fromSalaryCredit !== 0 ||
    fromOtherDebit !== 0 ||
    fromOtherCredit !== 0 ||
    fromInvoiceDebit !== 0 ||
    fromInvoiceCredit !== 0

  let columns
  if (hasPhysicalColumns) {
    // Single source of truth: ό,τι φέρνει το view
    columns = {
      salary_debit: fromSalaryDebit,
      salary_credit: fromSalaryCredit,
      other_debit: fromOtherDebit,
      other_credit: fromOtherCredit,
      invoice_amount: fromInvoiceDebit,
      invoice_credit: fromInvoiceCredit,
    }
  } else {
    // Legacy / κενές στήλες — fallback από type + amount
    const amount = entryAmount(entry)
    const forceInvoice = options.forceInvoice ?? null
    const sideFromSource =
      String(entry?.source || '').toUpperCase() === 'PAYMENT' ? 'CREDIT' : 'DEBIT'
    columns = distributeLedgerAmount(type, amount, {
      ...options,
      forceInvoice,
      side: options.side || sideFromSource,
    })
  }

  const rawDesc = String(entry?.description || '').trim()
  let description = rawDesc && !isBareEuroText(rawDesc) ? rawDesc : ''

  // Δόση δανείου (94): αν λείπει description, προβολή προόδου από notes (π.χ. «Δόση 3/13»)
  const typeId = Number(type?.id ?? entry?.ept_id ?? entry?.type_id)
  if (!description && typeId === LOAN_INSTALLMENT_TYPE_ID) {
    description = extractLoanInstallmentProgress(entry?.notes)
  }

  return {
    ...entry,
    ...columns,
    description,
    __template: false,
    __saved: true,
    __type: transactionType || null,
    ept_id: transactionType?.id ?? entry?.ept_id ?? null,
    _gridKey: ledgerRowKey(entry) || `saved-${entry?.source}-${entry?.id}`,
  }
}

/**
 * Template rows that auto-show amount from Αποδοχές / Admin ώρες:
 * Μισθός, Ticket + ποσότητα×τιμή (Υπερωρίες, Αργίες, Νυχτερινά, Μετρό, Διανυκτέρευση).
 */
export const DEFAULT_EARNINGS_PREFILL_IDS = new Set([
  3, // Μισθός → salary_debit (πάντα)
  24, // Ticket Restaurant → other_credit
  ...OTHER_DEBIT_IDS, // 7,8,9,22,25 → other_debit
])

function emptyTemplateRow(type, monthContext = null) {
  const id = Number(type?.id)
  const ctx = monthContext || {}
  const description = buildLedgerDescriptionForType(type, ctx) || ''

  let salary_debit = 0
  let salary_credit = 0
  let other_debit = 0
  let other_credit = 0
  let invoice_amount = 0
  let invoice_credit = 0
  let __prefilled = false

  if (DEFAULT_EARNINGS_PREFILL_IDS.has(id)) {
    const amount = buildLedgerAmountForType(type, ctx)
    if (amount > 0) {
      // Prefill ποτέ δεν στέλνει σε τιμολόγιο — μόνο κλασικές στήλες
      const cols = distributeLedgerAmount(type, amount, { forceInvoice: false })
      salary_debit = cols.salary_debit
      salary_credit = cols.salary_credit
      other_debit = cols.other_debit
      other_credit = cols.other_credit
      invoice_amount = 0
      invoice_credit = 0
      __prefilled = true
    }
  }

  return {
    __template: true,
    __saved: false,
    __prefilled,
    __type: type,
    ept_id: type.id,
    _gridKey: `template-${type.id}`,
    id: null,
    source: 'PAYROLL',
    entry_date: '',
    type: type.description,
    description,
    salary_debit,
    salary_credit,
    other_debit,
    other_credit,
    invoice_amount,
    invoice_credit,
    notes: '',
    created_at: null,
  }
}

/**
 * Σταθερή σειρά εμφάνισης στο μηνιαίο grid (μετά την ημερομηνία).
 * Μισθός → Υπόλοιπο Μισθού → Λογιστής → Οδηγού → ώρες → λοιπά/έξτρα.
 */
export const LEDGER_DISPLAY_TYPE_ORDER = {
  3: 10, // Μισθός
  4: 20, // Υπόλοιπο Μισθού
  23: 30, // Λογιστής
  21: 40, // Επίδομα οδηγού
  7: 50, // Υπερωρίες
  8: 51, // Αργίες
  9: 52, // Νυχτερινά
  25: 53, // Μετρό
  22: 54, // Διανυκτέρευση
  13: 70, // Επίδομα Αδείας
  11: 80, // Δώρο Πάσχα
  12: 81, // Δώρο Χριστουγέννων
  5: 90, // Bonus (χειροκίνητο)
  41: 91, // Bonus+ (ιστορικό)
  2: 200, // Προκαταβολή
  91: 210, // Εξόφληση Μισθού
  92: 211, // Εξόφληση Λοιπών
  93: 212, // Εξόφληση Τιμολογίου
  94: 220, // Δόση Δανείου
  95: 221, // Εκταμίευση Δανείου
}

const LEDGER_DISPLAY_ORDER_FALLBACK = 500

function ledgerRowTypeId(row) {
  const fromType = Number(row?.__type?.id ?? row?.ept_id ?? row?.type_id)
  if (Number.isFinite(fromType) && fromType > 0) return fromType
  return null
}

function ledgerDisplayOrder(row) {
  const id = ledgerRowTypeId(row)
  if (id != null && Object.prototype.hasOwnProperty.call(LEDGER_DISPLAY_TYPE_ORDER, id)) {
    return LEDGER_DISPLAY_TYPE_ORDER[id]
  }
  return LEDGER_DISPLAY_ORDER_FALLBACK
}

function compareSavedEntries(a, b) {
  const dateA = String(a.entry_date || '')
  const dateB = String(b.entry_date || '')
  if (dateA !== dateB) return dateA.localeCompare(dateB)
  const orderA = ledgerDisplayOrder(a)
  const orderB = ledgerDisplayOrder(b)
  if (orderA !== orderB) return orderA - orderB
  const createdA = String(a.created_at || '')
  const createdB = String(b.created_at || '')
  if (createdA !== createdB) return createdA.localeCompare(createdB)
  return String(a.id || '').localeCompare(String(b.id || ''))
}

function applyTypeLabelGrouping(rows) {
  return rows.map((row, index, allRows) => {
    const typeId = row.__type?.id ?? row.ept_id ?? null
    const prev = index > 0 ? allRows[index - 1] : null
    const prevTypeId = prev?.__type?.id ?? prev?.ept_id ?? null
    const showTypeLabel = typeId == null ? true : typeId !== prevTypeId
    return { ...row, __showTypeLabel: showTypeLabel }
  })
}

/**
 * Build ledger grid rows from saved entries only (no empty type templates).
 * Rows without real amounts are omitted — empty month ⇒ empty table.
 */
export function buildTemplateMergeRows({
  transactionTypes = [],
  savedEntries = [],
  typeLookup,
  monthContext = null,
}) {
  void transactionTypes
  void monthContext
  const sourceRows = Array.isArray(savedEntries) ? [...savedEntries] : []

  const rows = []
  for (const row of sourceRows) {
    const matchedType = resolveTransactionTypeFromLedgerRow(typeLookup, row)
    if (matchedType && !isLedgerTypeVisible(matchedType)) continue

    const normalized = normalizeSavedEntry(row, matchedType)
    const { amount } = extractLedgerAmount(normalized)
    const invoiceDebit = Math.abs(Number(normalized.invoice_amount) || 0)
    const invoiceCredit = Math.abs(Number(normalized.invoice_credit) || 0)
    if (Math.abs(amount) < 0.005 && invoiceDebit < 0.005 && invoiceCredit < 0.005) continue
    rows.push(normalized)
  }

  rows.sort(compareSavedEntries)
  return applyTypeLabelGrouping(rows)
}

export function ledgerRowClassName(row, isSelected) {
  const parts = ['h-9 cursor-pointer border-b border-white/10 transition-colors']
  if (row.__template) {
    parts.push('ledger-row--template bg-slate-900/40 text-slate-400')
  } else if (row.__saved) {
    parts.push('ledger-row--saved bg-slate-950/20')
  }
  if (isSelected) {
    // Μόνιμο highlight ≈ ένταση hover (όχι μόνο στο mouseover)
    parts.push(
      'bg-amber-400/35 ring-2 ring-inset ring-amber-400 hover:bg-amber-400/40'
    )
  } else {
    parts.push('hover:bg-slate-800/50')
  }
  return parts.join(' ')
}
