/** Αποδοχές τεχνικού — map UI ↔ DIAS table `tech_earnings`. */

import { parseElNumber } from './numberFormat'

export const EARNINGS_ROW_DEFS = [
  // Ομάδα 1 (με checkbox Δημιουργίας) — εμφανίζονται πρώτα μαζί με amount-only
  { key: 'salary', label: 'Μισθός' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'bonus_plus', label: 'Bonus +' },
  // Ομάδα 2 (χωρίς checkbox Δημιουργίας) — rates / ποσά ωρών
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

/** Keys που θεωρούνται Βασικό/Στάνταρ όταν λείπει τιμή στο JSON. */
export const FIXED_EXPENSE_DEFAULT_TRUE_KEYS = new Set([
  'salary',
  'bonus',
  'driver_allowance',
  'accountant',
])

/**
 * transaction_types.id → κλειδί αποδοχών (για Βασικό/Μεταβλητό ανά μήνα).
 * 3 Μισθός · 4 Bonus · 41 Bonus+ · 21 Οδηγού · 23 Λογιστής ·
 * 7 Υπερωρίες · 8 Αργίες · 9 Νυχτερινά · 22 Διανυκτέρευση · 25 Μετρό · 24 Ticket
 */
export const EARNINGS_KEY_BY_TYPE_ID = {
  3: 'salary',
  4: 'bonus',
  41: 'bonus_plus',
  21: 'driver_allowance',
  23: 'accountant',
  7: 'overtime',
  8: 'holiday',
  9: 'night',
  22: 'overnight',
  25: 'metro',
  24: 'ticket',
}

/** type_code / type string → earnings key (payroll_entries στο view). */
export const EARNINGS_KEY_BY_TYPE_CODE = {
  base_salary: 'salary',
  salary: 'salary',
  μισθός: 'salary',
  μισθος: 'salary',
  bonus: 'bonus',
  bonus_plus: 'bonus_plus',
  'bonus +': 'bonus_plus',
  overtime: 'overtime',
  υπερωρίες: 'overtime',
  υπερωριες: 'overtime',
  holiday: 'holiday',
  αργίες: 'holiday',
  αργιες: 'holiday',
  night: 'night',
  νυχτερινά: 'night',
  νυχτερινα: 'night',
  overnight: 'overnight',
  διανυκτέρευση: 'overnight',
  διανυκτερευση: 'overnight',
  metro: 'metro',
  μετρό: 'metro',
  μετρο: 'metro',
  ticket: 'ticket',
  'ticket restaurant': 'ticket',
  driver_allowance: 'driver_allowance',
  επίδομα_οδηγού: 'driver_allowance',
  'επίδομα οδηγού': 'driver_allowance',
  accountant: 'accountant',
  λογιστής: 'accountant',
  λογιστης: 'accountant',
}

/**
 * Αντιστοίχιση γραμμής ledger → κλειδί αποδοχών (ή null αν άγνωστο → μεταβλητό).
 */
export function earningsKeyFromLedgerRow(row) {
  if (!row) return null
  const tid = Number(row.type_id ?? row.ept_id)
  if (Number.isFinite(tid) && EARNINGS_KEY_BY_TYPE_ID[tid]) {
    return EARNINGS_KEY_BY_TYPE_ID[tid]
  }
  const typeStr = String(row.type || row.type_code || '')
    .trim()
    .toLowerCase()
  if (typeStr && EARNINGS_KEY_BY_TYPE_CODE[typeStr]) {
    return EARNINGS_KEY_BY_TYPE_CODE[typeStr]
  }
  const desc = String(row.description || row.notes || '')
    .trim()
    .toLowerCase()
  for (const [needle, key] of Object.entries(EARNINGS_KEY_BY_TYPE_CODE)) {
    if (desc === needle || desc.startsWith(`${needle} `)) return key
  }
  // Label match από EARNINGS_ROW_DEFS / amount-only
  for (const def of EARNINGS_ROW_DEFS) {
    if (typeStr === def.label.toLowerCase() || desc === def.label.toLowerCase()) return def.key
  }
  for (const def of EARNINGS_AMOUNT_ONLY_DEFS) {
    if (typeStr === def.label.toLowerCase() || desc === def.label.toLowerCase()) return def.key
  }
  return null
}

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

/** Όλα τα κλειδιά τύπων αποδοχών που έχουν στήλη «Βασικό». */
export function allFixedExpenseKeys() {
  const keys = EARNINGS_ROW_DEFS.map((d) => d.key)
  for (const d of EARNINGS_AMOUNT_ONLY_DEFS) keys.push(d.key)
  return keys
}

export function emptyFixedExpenseSettings() {
  const out = {}
  for (const key of allFixedExpenseKeys()) {
    out[key] = FIXED_EXPENSE_DEFAULT_TRUE_KEYS.has(key)
  }
  return out
}

/**
 * Κανονικοποίηση JSON από DB · άγνωστα keys αγνοούνται ·
 * keys χωρίς τιμή παίρνουν default (Μισθός = true).
 */
export function normalizeFixedExpenseSettings(raw) {
  const defaults = emptyFixedExpenseSettings()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults
  const out = { ...defaults }
  for (const key of allFixedExpenseKeys()) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      out[key] = raw[key] === true
    }
  }
  return out
}

/** True αν ο τύπος είναι βασικό/στάνταρ μηνιαίο έξοδο. */
export function isFixedExpense(form, key) {
  const settings = form?.fixed_expense_settings
  if (settings && Object.prototype.hasOwnProperty.call(settings, key)) {
    return settings[key] === true
  }
  return FIXED_EXPENSE_DEFAULT_TRUE_KEYS.has(key)
}

export function emptyEarningsForm() {
  const form = {
    bank_account: '',
    bank_name: '',
    issues_invoice: false,
    extra: '',
    auto_transfer_settings: emptyAutoTransferSettings(),
    fixed_expense_settings: emptyFixedExpenseSettings(),
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
  form.fixed_expense_settings = normalizeFixedExpenseSettings(row.fixed_expense_settings)
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
    fixed_expense_settings: normalizeFixedExpenseSettings(form.fixed_expense_settings),
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
