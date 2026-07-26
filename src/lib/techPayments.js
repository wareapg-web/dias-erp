/** payment_entries — Πληρωμές τεχνικού */

export const PAYMENT_TYPES = [
  { value: 'ADVANCE', label: 'Έναντι' },
  { value: 'SETTLEMENT', label: 'Εξόφληση' },
  { value: 'SETTLEMENT_1', label: 'Εξόφληση (1)' },
  { value: 'SETTLEMENT_2', label: 'Εξόφληση (2)' },
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
  const n = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n)) throw new Error('Μη έγκυρο ποσό')
  return n
}

/** Payload insert στο DIAS payment_entries (+ legacy columns αν υπάρχουν). */
export function paymentToDb(form, tech) {
  const paymentDate = form.payment_date || new Date().toISOString().slice(0, 10)
  const paymentType = String(form.payment_type || 'ADVANCE').trim().toUpperCase()
  const amount = toNumberRequired(form.amount)
  const d = new Date(paymentDate)

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
    month: Number.isFinite(d.getMonth()) ? d.getMonth() + 1 : null,
    year: Number.isFinite(d.getFullYear()) ? d.getFullYear() : null,
    description: String(form.notes || '').trim() || paymentType,
  }
}

export function formatPaymentAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('el-GR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(n)
}
