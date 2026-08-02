/**
 * Runtime helpers for transaction_types (JS — used by MovementModal + ledger grid).
 * Canonical types: ../types/transactionTypes.ts
 */

import { diasClient } from './supabase'
import { extractLedgerAmount } from './techLedger'

/** ledger_group === 'SALARY' → Μισθός columns (is_salary_type). */
export function isSalaryLedgerGroup(ledgerGroup) {
  return String(ledgerGroup || '').toUpperCase() === 'SALARY'
}

export function ledgerGroupLabel(ledgerGroup) {
  const g = String(ledgerGroup || '').toUpperCase()
  if (g === 'SALARY') return 'Μισθός'
  if (g === 'INVOICE') return 'Τιμολόγιο'
  return 'Λοιπά'
}

/** @deprecated use isSalaryLedgerGroup — kept for old col_index rows during transition */
export function isSalaryColIndex(colIndex) {
  return Number(colIndex) === 1
}

/**
 * Target grid column from ledger_group + side (DEBIT|CREDIT).
 * @returns {'salary_debit'|'salary_credit'|'other_debit'|'other_credit'|'invoice_amount'|'invoice_credit'}
 */
export function ledgerColumnFor(ledgerGroup, side) {
  const g = String(ledgerGroup || '').toUpperCase()
  if (g === 'INVOICE') {
    return String(side || '').toUpperCase() === 'CREDIT' ? 'invoice_credit' : 'invoice_amount'
  }
  const salary = g === 'SALARY'
  const credit = String(side || '').toUpperCase() === 'CREDIT'
  if (salary) return credit ? 'salary_credit' : 'salary_debit'
  return credit ? 'other_credit' : 'other_debit'
}

export function sideFromLedgerBucket(bucket) {
  if (
    bucket === 'salary_credit' ||
    bucket === 'other_credit' ||
    bucket === 'invoice_credit'
  ) {
    return 'CREDIT'
  }
  return 'DEBIT'
}

export function ledgerColumnLabel(column) {
  const map = {
    salary_debit: 'Μισθός Χρέωση',
    salary_credit: 'Μισθός Πίστωση',
    other_debit: 'Λοιπά Χρέωση',
    other_credit: 'Λοιπά Πίστωση',
    invoice_amount: 'Τιμολόγιο Χρέωση',
    invoice_credit: 'Τιμολόγιο Πίστωση',
  }
  return map[column] || column || '—'
}

/** Load active transaction types from DIAS Supabase. */
export async function fetchTransactionTypes() {
  const { data, error } = await diasClient
    .from('transaction_types')
    .select('id, description, ledger_group, is_for_sum, sort_order, is_active, ept_type_pay')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw error
  return data || []
}

/** description → TransactionType map (case-insensitive fallback). */
export function buildTypeLookup(types = []) {
  const byId = new Map()
  const byDescription = new Map()
  const byDescriptionLower = new Map()

  for (const t of types) {
    byId.set(Number(t.id), t)
    byDescription.set(t.description, t)
    byDescriptionLower.set(String(t.description || '').toLowerCase(), t)
  }

  return { byId, byDescription, byDescriptionLower, list: types }
}

/** Default transaction_type id hints for payment_entries.payment_type codes. */
const PAYMENT_CODE_TYPE_IDS = {
  // SETTLEMENT = εξόφληση τιμολογίου (κουμπί ΕΞΟΦΛΗΣΗ(ΤΙΜ) / type 93) — όχι το παλιό id 1
  SETTLEMENT: 93,
  SETTLEMENT_1: 91,
  SETTLEMENT_2: 92,
  ADVANCE: 2,
  BONUS_PAYOUT: 4,
  EXPENSES: 24,
}

export function resolveTransactionType(lookup, { typeId, description, typeCode } = {}) {
  if (!lookup) return null
  if (typeId != null && lookup.byId.has(Number(typeId))) {
    return lookup.byId.get(Number(typeId))
  }

  const tryDescription = (value) => {
    if (!value) return null
    if (lookup.byDescription.has(value)) return lookup.byDescription.get(value)
    return lookup.byDescriptionLower.get(String(value).toLowerCase()) || null
  }

  const fromDesc = tryDescription(description)
  if (fromDesc) return fromDesc

  const fromCode = tryDescription(typeCode)
  if (fromCode) return fromCode

  if (typeCode) {
    const code = String(typeCode)
    const fromList = lookup.list.find(
      (t) =>
        t.description === code ||
        String(t.description).toLowerCase() === code.toLowerCase()
    )
    if (fromList) return fromList
  }

  return null
}

/**
 * Resolve transaction_types row from a tech_ledger_view row (edit mode).
 * Prefers type_id · μετά πιστωτική στήλη · μετά payment_type code.
 */
export function resolveTransactionTypeFromLedgerRow(lookup, row) {
  if (!lookup || !row) return null

  const storedTypeId = row.type_id ?? row.ept_id ?? null
  if (storedTypeId != null && lookup.byId.has(Number(storedTypeId))) {
    return lookup.byId.get(Number(storedTypeId))
  }

  const typeCode = String(row.type || '').trim()
  const { bucket } = extractLedgerAmount(row)

  // TIM / invoice credit πριν το generic SETTLEMENT→label
  if (bucket === 'invoice_credit') {
    return lookup.byId.get(93) || null
  }
  if (bucket === 'salary_credit') {
    return lookup.byId.get(91) || lookup.byId.get(1) || null
  }
  if (bucket === 'other_credit') {
    return lookup.byId.get(92) || lookup.byId.get(24) || null
  }

  if (row.source === 'PAYMENT' && typeCode) {
    const hintedId = PAYMENT_CODE_TYPE_IDS[typeCode.toUpperCase()]
    if (hintedId != null && lookup.byId.has(hintedId)) {
      return lookup.byId.get(hintedId)
    }
  }

  let hit = resolveTransactionType(lookup, { description: typeCode, typeCode })
  if (hit) return hit

  return null
}

export function resolveLedgerGroupForRow(lookup, row) {
  const tt = resolveTransactionTypeFromLedgerRow(lookup, row)
  if (tt?.ledger_group) return tt.ledger_group

  const { bucket } = extractLedgerAmount(row)
  if (bucket.startsWith('salary')) return 'SALARY'
  if (bucket.startsWith('other')) return 'OTHER'
  return 'OTHER'
}

/**
 * payment_entries.payment_type for credit postings.
 * Uses description heuristics + ledger_group for column routing in tech_ledger_view.
 */
export function paymentTypeCodeFromDescription(description, ledgerGroup) {
  const d = String(description || '')
  const lower = d.toLowerCase()
  const salary = isSalaryLedgerGroup(ledgerGroup)

  // 93 / Εξόφληση Τιμολογίου → SETTLEMENT + invoice_credit
  if (
    lower.includes('τιμολογ') ||
    lower.includes('τιμ') ||
    /\(τιμ\)/i.test(d)
  ) {
    return 'SETTLEMENT'
  }
  // 92 / Εξόφληση Λοιπών (και legacy «(2)»)
  if (
    lower.includes('λοιπ') ||
    lower.includes('εξόφληση (2)') ||
    lower.includes('εξοφληση (2)') ||
    /\(2\)/.test(d)
  ) {
    return 'SETTLEMENT_2'
  }
  // 91 / Εξόφληση Μισθού (και legacy «(1)»)
  if (
    lower.includes('μισθ') ||
    lower.includes('εξόφληση (1)') ||
    lower.includes('εξοφληση (1)') ||
    /\(1\)/.test(d)
  ) {
    return 'SETTLEMENT_1'
  }
  if (lower.includes('εξόφληση') || lower.includes('εξοφληση')) {
    return salary ? 'SETTLEMENT_1' : 'SETTLEMENT_2'
  }
  if (lower.includes('προκαταβολή') || lower.includes('προκαταβολη')) return 'ADVANCE'
  if (lower.includes('έναντι') || lower.includes('εναντι')) return 'ADVANCE'
  if (lower.includes('έξοδα') || lower.includes('εξοδα')) return 'EXPENSES'
  if (lower.includes('bonus')) return 'BONUS_PAYOUT'
  if (lower.includes('δανειο') || lower.includes('δάνειο')) return salary ? 'ADVANCE' : 'EXPENSES'
  return salary ? 'SETTLEMENT' : 'SETTLEMENT_2'
}

export function payrollTypeCodeFromDescription(description) {
  return String(description || '').trim() || 'Κίνηση'
}

/** True when posting should go to payment_entries (credit side). */
export function shouldPostAsPayment(side) {
  return String(side || '').toUpperCase() === 'CREDIT'
}

/**
 * Κατανομή ποσού στις φυσικές credit στήλες του payment_entries.
 * Ακριβώς μία από salary_credit / other_credit / invoice_credit παίρνει το ποσό.
 */
export function paymentCreditColumns({
  amount,
  paymentType,
  postToInvoice = false,
  typeId = null,
  ledgerGroup = null,
}) {
  const abs = Math.abs(Number(amount) || 0)
  const pt = String(paymentType || '').toUpperCase()
  const id = Number(typeId)

  if (postToInvoice || id === 93 || pt.includes('TIM') || pt === 'SETTLEMENT') {
    return {
      salary_debit: 0,
      salary_credit: 0,
      other_debit: 0,
      other_credit: 0,
      invoice_amount: 0,
      invoice_credit: abs,
    }
  }

  const toOther =
    id === 92 ||
    pt === 'SETTLEMENT_2' ||
    pt === 'EXPENSES' ||
    pt === 'BONUS_PAYOUT' ||
    (ledgerGroup != null && !isSalaryLedgerGroup(ledgerGroup) && id !== 91)

  if (toOther) {
    return {
      salary_debit: 0,
      salary_credit: 0,
      other_debit: 0,
      other_credit: abs,
      invoice_amount: 0,
      invoice_credit: 0,
    }
  }

  // 91 / SETTLEMENT_1 / ADVANCE / SETTLEMENT → Μισθός Πιστ.
  return {
    salary_debit: 0,
    salary_credit: abs,
    other_debit: 0,
    other_credit: 0,
    invoice_amount: 0,
    invoice_credit: 0,
  }
}

/** Default side for a type — settlement-like → CREDIT, else DEBIT. */
export function defaultSideForType(description) {
  const lower = String(description || '').toLowerCase()
  if (
    lower.includes('εξόφληση') ||
    lower.includes('εξοφληση') ||
    lower.includes('προκαταβολή') ||
    lower.includes('προκαταβολη') ||
    lower.includes('έναντι') ||
    lower.includes('εναντι')
  ) {
    return 'CREDIT'
  }
  return 'DEBIT'
}
