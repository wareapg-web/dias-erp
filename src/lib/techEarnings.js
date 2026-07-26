/** Αποδοχές τεχνικού — map UI ↔ DIAS table `tech_earnings`. */

export const EARNINGS_ROW_DEFS = [
  { key: 'salary', label: 'Μισθός' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'overtime', label: 'Υπερωρίες' },
  { key: 'holiday', label: 'Αργίες' },
  { key: 'night', label: 'Νυχτερινά' },
  { key: 'overnight', label: 'Διανυκτέρευση' },
  { key: 'ticket', label: 'Ticket Restaurant' },
  { key: 'metro', label: 'Μετρό' },
  { key: 'bonus_plus', label: 'Bonus +' },
]

export function emptyEarningsForm() {
  const form = {
    bank_account: '',
    bank_name: '',
    issues_invoice: false,
    extra: '',
  }
  for (const row of EARNINGS_ROW_DEFS) {
    form[`${row.key}_amount`] = ''
    form[`${row.key}_from`] = row.key === 'overtime' ? '8' : ''
    form[`${row.key}_min`] = ''
  }
  return form
}

function numOrEmpty(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : ''
}

export function earningsFromDb(row) {
  if (!row) return emptyEarningsForm()
  const form = emptyEarningsForm()
  form.bank_account = row.bank_account || ''
  form.bank_name = row.bank_name || ''
  form.issues_invoice = Boolean(row.issues_invoice)
  form.extra = row.extra || ''
  for (const def of EARNINGS_ROW_DEFS) {
    form[`${def.key}_amount`] = numOrEmpty(row[`${def.key}_amount`])
    form[`${def.key}_from`] = numOrEmpty(row[`${def.key}_from`])
    form[`${def.key}_min`] = numOrEmpty(row[`${def.key}_min`])
  }
  return form
}

function toNumber(value, fallback = 0) {
  if (value === '' || value == null) return fallback
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : fallback
}

/** Payload για upsert στο DIAS `tech_earnings`. */
export function earningsToDb(form, tech) {
  const payload = {
    tech_id: String(tech.id),
    tech_name: tech.name || null,
    bank_account: form.bank_account?.trim() || null,
    bank_name: form.bank_name?.trim() || null,
    issues_invoice: Boolean(form.issues_invoice),
    extra: form.extra?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  for (const def of EARNINGS_ROW_DEFS) {
    payload[`${def.key}_amount`] = toNumber(form[`${def.key}_amount`])
    payload[`${def.key}_from`] = toNumber(form[`${def.key}_from`])
    payload[`${def.key}_min`] = toNumber(form[`${def.key}_min`])
  }
  return payload
}

/** Σύνολο ποσών (στήλη Ποσό) — όπως παλιό ERP. */
export function earningsTotal(form) {
  return EARNINGS_ROW_DEFS.reduce((sum, def) => sum + toNumber(form[`${def.key}_amount`]), 0)
}
