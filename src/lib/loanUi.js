/** Loan helpers — 94 = δόση (ghost) · 95 = εκταμίευση (ταμειακή). */

export const LOAN_INSTALLMENT_TYPE_ID = 94
export const LOAN_DISBURSEMENT_TYPE_ID = 95

/** @deprecated use LOAN_INSTALLMENT_TYPE_ID */
export const LOAN_TYPE_ID = LOAN_INSTALLMENT_TYPE_ID

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
  const round2 = (n) => Math.round(n * 100) / 100
  return {
    salary: round2(salary),
    other: round2(other),
    invoice: round2(invoice),
  }
}
