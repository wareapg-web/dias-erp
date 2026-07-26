/** tech_agreements — normalized rates (APG EMPLOEE_MISTO mirror) */

export const AGREEMENT_TYPES = [
  { value: 'BASE_SALARY', label: 'Base / Μισθός' },
  { value: 'HOURLY_RATE', label: 'Hourly / Ωρομίσθιο' },
  { value: 'OVERTIME', label: 'Overtime / Υπερωρίες' },
  { value: 'BONUS', label: 'Bonus' },
  { value: 'HOLIDAY', label: 'Αργίες' },
  { value: 'NIGHT', label: 'Νυχτερινά' },
  { value: 'OVERNIGHT', label: 'Διανυκτέρευση' },
  { value: 'TRAVEL', label: 'Travel / Μετακίνηση' },
  { value: 'METRO', label: 'Μετρό' },
  { value: 'TICKET', label: 'Ticket' },
]

export function agreementTypeLabel(code) {
  return AGREEMENT_TYPES.find((t) => t.value === code)?.label || code || '—'
}

export function emptyAgreementForm() {
  return {
    type_code: 'BASE_SALARY',
    amount: '',
    up_from: '',
    minimum: '',
    valid_from: new Date().toISOString().slice(0, 10),
  }
}

function toNumberOrNull(value) {
  if (value === '' || value == null) return null
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function toNumberRequired(value) {
  const n = toNumberOrNull(value)
  if (n == null) throw new Error('Συμπλήρωσε ποσό')
  return n
}

/** Args για diasClient.rpc('add_tech_agreement', ...) */
export function agreementRpcArgs(form, techId) {
  return {
    p_tech_id: String(techId),
    p_type_code: String(form.type_code || '').trim().toUpperCase(),
    p_amount: toNumberRequired(form.amount),
    p_up_from: toNumberOrNull(form.up_from),
    p_minimum: toNumberOrNull(form.minimum),
    p_valid_from: form.valid_from || null,
  }
}

export function formatAgreementAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('el-GR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(n)
}
