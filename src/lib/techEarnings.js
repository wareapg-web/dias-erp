/** Αποδοχές τεχνικού — map UI ↔ DIAS table `tech_earnings`. */

import { parseElNumber } from './numberFormat'

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

/**
 * Γραμμές με μόνο στήλη Ποσό (κενά > από / Ελάχιστο).
 * dbColumn: αν οριστεί, form key + DB column = dbColumn (π.χ. driver_allowance).
 * αλλιώς form/DB = `${key}_amount` (π.χ. accountant_amount).
 */
export const EARNINGS_AMOUNT_ONLY_DEFS = [
  { key: 'driver_allowance', label: 'Επίδομα οδηγού', dbColumn: 'driver_allowance' },
  { key: 'accountant', label: 'Λογιστής', invoiceOnly: true },
]

/** Form / DB field name για amount-only γραμμή. */
export function amountOnlyField(def) {
  return def.dbColumn || `${def.key}_amount`
}

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
  for (const row of EARNINGS_AMOUNT_ONLY_DEFS) {
    form[amountOnlyField(row)] = ''
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
  for (const def of EARNINGS_AMOUNT_ONLY_DEFS) {
    const field = amountOnlyField(def)
    form[field] = numOrEmpty(row[field])
  }
  return form
}

function toNumber(value, fallback = 0) {
  if (value === '' || value == null) return fallback
  const n = parseElNumber(value)
  return n != null ? n : fallback
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
  for (const def of EARNINGS_AMOUNT_ONLY_DEFS) {
    const field = amountOnlyField(def)
    payload[field] = toNumber(form[field])
  }
  return payload
}

/** Σύνολο ποσών (στήλη Ποσό) — βασικές γραμμές + amount-only (οδηγού, λογιστής, …). */
export function earningsTotal(form) {
  const base = EARNINGS_ROW_DEFS.reduce((s, def) => s + toNumber(form[`${def.key}_amount`]), 0)
  const extras = EARNINGS_AMOUNT_ONLY_DEFS.reduce(
    (s, def) => s + toNumber(form[amountOnlyField(def)]),
    0
  )
  return base + extras
}
