/** Loan helpers — 94 = δόση (ghost) · 95 = εκταμίευση (ταμειακή). */

export const LOAN_INSTALLMENT_TYPE_ID = 94
export const LOAN_DISBURSEMENT_TYPE_ID = 95

/** @deprecated use LOAN_INSTALLMENT_TYPE_ID */
export const LOAN_TYPE_ID = LOAN_INSTALLMENT_TYPE_ID

export function generateLoanBatchId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `loan-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function isLoanInstallmentRow(row) {
  if (!row) return false
  if (Number(row.type_id) === LOAN_INSTALLMENT_TYPE_ID) return true
  const notes = String(row.notes || '')
  if (notes.startsWith('Εκταμίευση Δανείου')) return false
  return notes.includes('Δόση')
}

export function isLoanDisbursementRow(row) {
  if (!row) return false
  if (Number(row.type_id) === LOAN_DISBURSEMENT_TYPE_ID) return true
  return String(row.notes || '').startsWith('Εκταμίευση Δανείου')
}

/** Κείμενο notes πριν την παρένθεση — π.χ. «Δάνειο (Δόση 2/15)» → «Δάνειο» */
export function loanNotesPrefix(notes) {
  const raw = String(notes || '').trim()
  const idx = raw.indexOf('(')
  if (idx > 0) return raw.slice(0, idx).trim()
  return raw || 'Δάνειο'
}

/** Base notes από δόση ή εκταμίευση για σύνδεση σειράς. */
export function loanSeriesNotesKey(notes) {
  const raw = String(notes || '').trim()
  if (raw.startsWith('Εκταμίευση Δανείου:')) {
    return raw.slice('Εκταμίευση Δανείου:'.length).trim() || 'Δάνειο'
  }
  return loanNotesPrefix(raw)
}

/**
 * Αλλαγή αιτιολογίας χωρίς να χαθεί το επίθημα δόσης / έκτακτης / εκταμίευσης.
 */
export function rebuildLoanEntryNotes(oldNotes, newLabel) {
  const label = String(newLabel || '').trim() || 'Δάνειο'
  const raw = String(oldNotes || '').trim()
  if (raw.startsWith('Εκταμίευση Δανείου:')) {
    return `Εκταμίευση Δανείου: ${label}`
  }
  if (/έκτακτη/i.test(raw)) {
    return `${label} (Έκτακτη καταβολή)`
  }
  const dose = raw.match(/\(Δόση\s*([^)]+)\)/i)
  if (dose) return `${label} (Δόση ${dose[1]})`
  return label
}

/** Όλα τα id γραμμών μιας ομάδας δανείου (95 + 94). */
export function loanGroupEntryIds(group) {
  const ids = []
  if (group?.disbursement?.id != null) ids.push(group.disbursement.id)
  for (const row of group?.installments || []) {
    if (row?.id != null) ids.push(row.id)
  }
  return ids
}

/** Λογιστική περίοδος → ακέραιο κλειδί (όχι payment_date). */
export function loanPeriodKey(year, month) {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null
  return y * 12 + m
}

/**
 * Σύγκριση δόσης με as-of UI period (selectedMonth / analysisYear).
 * ≤ asOf → πληρωμένη/τρέχουσα · > asOf → υπόλοιπο (μέλλον).
 */
export function compareInstallmentToAsOf(row, asOfMonth, asOfYear) {
  const rowKey = loanPeriodKey(row?.year, row?.month)
  const asOfKey = loanPeriodKey(asOfYear, asOfMonth)
  if (rowKey == null || asOfKey == null) return 'unknown'
  if (rowKey <= asOfKey) return 'paid'
  return 'future'
}

export function isPaidOrCurrentInstallment(row, asOfMonth, asOfYear) {
  return compareInstallmentToAsOf(row, asOfMonth, asOfYear) === 'paid'
}

export function isFutureInstallment(row, asOfMonth, asOfYear) {
  return compareInstallmentToAsOf(row, asOfMonth, asOfYear) === 'future'
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** Ποσό γραμμής δανείου από amount ή φυσικές credit στήλες. */
export function loanRowAmount(row) {
  if (!row) return 0
  const fromAmount = Number(row.amount)
  if (Number.isFinite(fromAmount) && fromAmount !== 0) return round2(Math.abs(fromAmount))
  const credits =
    (Number(row.salary_credit) || 0) +
    (Number(row.other_credit) || 0) +
    (Number(row.invoice_credit) || 0)
  return round2(Math.abs(credits))
}

function legacyGroupKey(row) {
  const notesKey = loanSeriesNotesKey(row?.notes)
  const payDate = String(row?.payment_date || row?.entry_date || '').slice(0, 10)
  return `legacy:${notesKey}|${payDate}`
}

/**
 * Ομαδοποίηση εγγραφών 94/95 ανά loan_batch_id · fallback notes+payment_date (legacy).
 * @returns {Array<{
 *   groupId: string,
 *   loanBatchId: string|null,
 *   legacyKey: string|null,
 *   label: string,
 *   disbursement: object|null,
 *   installments: object[],
 *   initialAmount: number,
 *   paidAmount: number,
 *   remainingAmount: number,
 * }>}
 */
export function groupLoanEntries(rows, asOfMonth, asOfYear) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()

  for (const row of list) {
    if (!isLoanInstallmentRow(row) && !isLoanDisbursementRow(row)) continue

    const batchId = row.loan_batch_id ? String(row.loan_batch_id) : null
    const groupId = batchId ? `batch:${batchId}` : legacyGroupKey(row)

    if (!map.has(groupId)) {
      map.set(groupId, {
        groupId,
        loanBatchId: batchId,
        legacyKey: batchId ? null : loanSeriesNotesKey(row.notes),
        label: loanSeriesNotesKey(row.notes) || 'Δάνειο',
        disbursement: null,
        installments: [],
      })
    }

    const g = map.get(groupId)
    if (!g.loanBatchId && batchId) g.loanBatchId = batchId
    if (isLoanDisbursementRow(row)) {
      g.disbursement = row
      g.label = loanSeriesNotesKey(row.notes) || g.label
    } else {
      g.installments.push(row)
    }
  }

  const groups = []
  for (const g of map.values()) {
    g.installments.sort((a, b) => {
      const ka = loanPeriodKey(a.year, a.month) ?? 0
      const kb = loanPeriodKey(b.year, b.month) ?? 0
      return ka - kb
    })

    const initialAmount = g.disbursement
      ? loanRowAmount(g.disbursement)
      : round2(g.installments.reduce((s, r) => s + loanRowAmount(r), 0))

    let paidAmount = 0
    let remainingAmount = 0
    for (const inst of g.installments) {
      const amt = loanRowAmount(inst)
      if (isFutureInstallment(inst, asOfMonth, asOfYear)) remainingAmount += amt
      else paidAmount += amt
    }

    groups.push({
      ...g,
      initialAmount: round2(initialAmount),
      paidAmount: round2(paidAmount),
      remainingAmount: round2(remainingAmount),
    })
  }

  groups.sort((a, b) => {
    const da = String(a.disbursement?.payment_date || a.disbursement?.entry_date || '')
    const db = String(b.disbursement?.payment_date || b.disbursement?.entry_date || '')
    if (da !== db) return db.localeCompare(da)
    return String(b.groupId).localeCompare(String(a.groupId))
  })

  return groups
}

/**
 * Λίστα πληρωμών UI: κρύβει δόσεις 94 · δείχνει κανονικά εκταμιεύσεις 95.
 * (Χωρίς εικονική ομαδοποίηση.)
 */
export function buildPaymentsDisplayList(payments) {
  const list = Array.isArray(payments) ? payments : []
  return list.filter((row) => !isLoanInstallmentRow(row))
}

/**
 * Άθροισμα δόσεων 94 ανά συρτάρι (salary / other / invoice) για εξόφληση.
 */
export function sumLoanInstallmentsByBucket(rows = []) {
  let salary = 0
  let other = 0
  let invoice = 0
  for (const r of rows || []) {
    if (r?.__template) continue
    if (!isLoanInstallmentRow(r)) continue
    salary += Number(r.salary_credit) || 0
    other += Number(r.other_credit) || 0
    invoice += Number(r.invoice_credit) || 0
  }
  return {
    salary: round2(salary),
    other: round2(other),
    invoice: round2(invoice),
  }
}

/** Μήνας/έτος μετά από offset (0 = έναρξη). */
export function periodAfterOffset(startMonth, startYear, offset) {
  const zeroBased = Number(startMonth) - 1 + Number(offset)
  const year = Number(startYear) + Math.floor(zeroBased / 12)
  const month = ((zeroBased % 12) + 12) % 12 + 1
  return { month, year }
}

/** Τραπεζική λογική: ακέραιες δόσεις 1..N-1 · η τελευταία απορροφά τη διαφορά. */
export function computeBankInstallments(totalAmount, numberOfInstallments) {
  const total = Number(totalAmount)
  const n = Math.floor(Number(numberOfInstallments))
  if (!(total > 0) || !(n >= 1)) {
    return { baseInstallment: null, lastInstallment: null }
  }
  const baseInstallment = Math.ceil(total / n)
  const lastInstallment = round2(total - baseInstallment * (n - 1))
  return { baseInstallment, lastInstallment }
}

/**
 * Φυσική στήλη πίστωσης από υπάρχουσα γραμμή δανείου.
 * @returns {'salary'|'other'|'invoice'}
 */
export function loanCreditCategoryFromRow(row) {
  if (!row) return 'salary'
  if ((Number(row.invoice_credit) || 0) !== 0) return 'invoice'
  if ((Number(row.other_credit) || 0) !== 0) return 'other'
  if ((Number(row.salary_credit) || 0) !== 0) return 'salary'
  const pt = String(row.payment_type || '').toUpperCase()
  if (pt === 'SETTLEMENT' || pt.includes('TIM')) return 'invoice'
  if (pt === 'SETTLEMENT_2' || pt === 'EXPENSES' || pt === 'BONUS_PAYOUT') return 'other'
  return 'salary'
}

export function loanCreditColumnsForCategory(category, amount) {
  const abs = Math.abs(Number(amount) || 0)
  return {
    salary_credit: category === 'salary' ? abs : 0,
    other_credit: category === 'other' ? abs : 0,
    invoice_credit: category === 'invoice' ? abs : 0,
    salary_debit: 0,
    other_debit: 0,
    invoice_amount: 0,
  }
}

export function paymentTypeForLoanCategory(category) {
  if (category === 'other') return 'SETTLEMENT_2'
  if (category === 'invoice') return 'SETTLEMENT'
  return 'SETTLEMENT_1'
}
