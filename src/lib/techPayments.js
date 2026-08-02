/** payment_entries — Πληρωμές τεχνικού */

import { parseElNumber } from './numberFormat'
import { paymentCreditColumns } from './transactionTypes'

export const PAYMENT_TYPES = [
  { value: 'ADVANCE', label: 'Έναντι' },
  { value: 'SETTLEMENT', label: 'Εξόφληση Τιμολογίου' },
  { value: 'SETTLEMENT_1', label: 'Εξόφληση Μισθού' },
  { value: 'SETTLEMENT_2', label: 'Εξόφληση Λοιπών' },
  { value: 'EXPENSES', label: 'Έξοδα' },
  { value: 'BONUS_PAYOUT', label: 'Πληρωμή Bonus' },
]

export function paymentTypeLabel(code) {
  return PAYMENT_TYPES.find((t) => t.value === code)?.label || code || '—'
}

export function emptyPaymentForm() {
  return {
    payment_date: new Date().toISOString().slice(0, 10),
    amount: '',
    payment_type: 'ADVANCE',
    notes: '',
  }
}

function toNumberRequired(value) {
  if (value === '' || value == null) throw new Error('Συμπλήρωσε ποσό')
  const n = parseElNumber(value)
  if (n == null) throw new Error('Μη έγκυρο ποσό')
  return n
}

/**
 * Payload insert στο DIAS payment_entries (+ legacy columns αν υπάρχουν).
 * @param {{ month?: number, year?: number }} [period] — λογιστική περίοδος UI (όχι από payment_date)
 */
export function paymentToDb(form, tech, period = {}) {
  const paymentDate = form.payment_date || new Date().toISOString().slice(0, 10)
  const paymentType = String(form.payment_type || 'ADVANCE').trim().toUpperCase()
  const amount = toNumberRequired(form.amount)
  const d = new Date(paymentDate)
  const fromDateMonth = Number.isFinite(d.getMonth()) ? d.getMonth() + 1 : null
  const fromDateYear = Number.isFinite(d.getFullYear()) ? d.getFullYear() : null
  const month = Number(period.month) || fromDateMonth
  const year = Number(period.year) || fromDateYear
  const credits = paymentCreditColumns({ amount, paymentType })
  const typeId =
    paymentType === 'SETTLEMENT'
      ? 93
      : paymentType === 'SETTLEMENT_1'
        ? 91
        : paymentType === 'SETTLEMENT_2'
          ? 92
          : paymentType === 'ADVANCE'
            ? 2
            : paymentType === 'BONUS_PAYOUT'
              ? 4
              : paymentType === 'EXPENSES'
                ? 24
                : null

  return {
    tech_id: String(tech.id),
    tech_name: tech.displayName || tech.name || null,
    payment_date: paymentDate,
    amount,
    payment_type: paymentType,
    notes: String(form.notes || '').trim() || null,
    // legacy bootstrap columns (safe if present)
    entry_date: paymentDate,
    entry_type: paymentType,
    month,
    year,
    description: null,
    type_id: typeId,
    ...credits,
  }
}

export function formatPaymentAmount(value) {
  const n = parseElNumber(value)
  if (n == null) return '—'
  return new Intl.NumberFormat('el-GR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(n)
}

/** Πίστωση στήλης: κενό/παύλα όταν 0 ή null (όπως παλιό ERP). */
export function formatPaymentCredit(value) {
  const n = parseElNumber(value)
  if (n == null || n === 0) return '—'
  return new Intl.NumberFormat('el-GR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(n)
}
