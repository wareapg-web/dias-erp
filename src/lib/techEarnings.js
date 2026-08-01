/** Αποδοχές τεχνικού — map UI ↔ DIAS table `tech_earnings`. */

import { parseElNumber } from './numberFormat'

export const EARNINGS_ROW_DEFS = [
  // Ομάδα 1 (με checkbox) — εμφανίζονται πρώτα μαζί με amount-only
  { key: 'salary', label: 'Μισθός' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'bonus_plus', label: 'Bonus +' },
  // Ομάδα 2 (χωρίς checkbox) — rates / ποσά ωρών
  { key: 'overtime', label: 'Υπερωρίες' },
  { key: 'holiday', label: 'Αργίες' },
  { key: 'night', label: 'Νυχτερινά' },
  { key: 'overnight', label: 'Διανυκτέρευση' },
  { key: 'ticket', label: 'Ticket Restaurant' },
  { key: 'metro', label: 'Μετρό' },
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

/**
 * Πεδία με σταθερό ποσό που μπορούν να μπουν στο «Δημιουργία» μέσω checkbox.
 * transferKey = κλειδί στο auto_transfer_settings / ποσό στο form.
 */
export const EARNINGS_AUTO_TRANSFER_DEFS = [
  { key: 'salary', transferKey: 'salary_amount', label: 'Μισθός' },
  { key: 'bonus', transferKey: 'bonus_amount', label: 'Bonus' },
  { key: 'bonus_plus', transferKey: 'bonus_plus_amount', label: 'Bonus +' },
  {
    key: 'driver_allowance',
    transferKey: 'driver_allowance',
    label: 'Επίδομα οδηγού',
    amountOnly: true,
  },
  {
    key: 'accountant',
    transferKey: 'accountant_amount',
    label: 'Λογιστής',
    amountOnly: true,
    invoiceOnly: true,
  },
]

/** Form / DB field name για amount-only γραμμή. */
export function amountOnlyField(def) {
  return def.dbColumn || `${def.key}_amount`
}

export function emptyAutoTransferSettings() {
  return {}
}

function normalizeAutoTransferSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyAutoTransferSettings()
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    out[String(k)] = v === true
  }
  return out
}

export function emptyEarningsForm() {
  const form = {
    bank_account: '',
    bank_name: '',
    issues_invoice: false,
    extra: '',
    auto_transfer_settings: emptyAutoTransferSettings(),
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
  form.auto_transfer_settings = normalizeAutoTransferSettings(row.auto_transfer_settings)
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
    auto_transfer_settings: normalizeAutoTransferSettings(form.auto_transfer_settings),
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

/** True αν η γραμμή Αποδοχών έχει checkbox για αυτόματη μεταφορά στη Δημιουργία. */
export function earningsRowHasAutoTransfer(def) {
  return EARNINGS_AUTO_TRANSFER_DEFS.some((t) => t.key === def.key)
}

export function autoTransferKeyForRow(def) {
  const hit = EARNINGS_AUTO_TRANSFER_DEFS.find((t) => t.key === def.key)
  return hit?.transferKey || null
}

/** Γραμμές 3-στηλών με checkbox (Μισθός, Bonus, Bonus +). */
export function earningsTransferRowDefs() {
  return EARNINGS_ROW_DEFS.filter((def) => earningsRowHasAutoTransfer(def))
}

/** Γραμμές 3-στηλών χωρίς checkbox (Υπερωρίες … Μετρό). */
export function earningsRateRowDefs() {
  return EARNINGS_ROW_DEFS.filter((def) => !earningsRowHasAutoTransfer(def))
}
