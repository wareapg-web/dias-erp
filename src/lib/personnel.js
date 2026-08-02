/** DIAS personnel (HR master) — mapping & helpers */

import { positionSortKey } from './greekDate'

export const EMPLOYMENT_TYPES = [
  { value: 'permanent', label: 'Μόνιμος' },
  { value: 'temporary', label: 'Έκτακτος' },
]

export const PAYMENT_METHODS = [
  { value: 'salary', label: 'Μισθός (χωρίς τιμολόγιο)' },
  { value: 'invoice', label: 'Με τιμολόγιο' },
  { value: 'mixed', label: 'Μικτό' },
]

export const MARITAL_STATUSES = [
  { value: '', label: '—' },
  { value: 'single', label: 'Άγαμος/η' },
  { value: 'married', label: 'Έγγαμος/η' },
  { value: 'divorced', label: 'Διαζευγμένος/η' },
  { value: 'widowed', label: 'Χήρος/α' },
]

export const BANKS = [
  { value: '', label: '—' },
  { value: 'EUROBANK', label: 'EUROBANK' },
  { value: 'ALPHA BANK', label: 'ALPHA BANK' },
  { value: 'ΠΕΙΡΑΙΩΣ', label: 'ΠΕΙΡΑΙΩΣ' },
  { value: 'ΕΘΝΙΚΗ', label: 'ΕΘΝΙΚΗ' },
]

export function employmentLabel(value) {
  if (value === 'contractor') return 'Συνεργάτης' // legacy rows
  return EMPLOYMENT_TYPES.find((t) => t.value === value)?.label || value || '—'
}

export function paymentMethodLabel(value) {
  return PAYMENT_METHODS.find((t) => t.value === value)?.label || value || '—'
}

export function emptyPersonnelForm() {
  return {
    tech_id: '',
    tech_name: '',
    code: '',
    last_name: '',
    first_name: '',
    hire_date: '',
    end_date: '',
    employment_type: 'permanent',
    payment_method: 'salary',
    admin_tech_id: '',
    photo_url: '',
    notes: '',
    is_active: true,
    position_number: '',
    address: '',
    address_number: '',
    area: '',
    zipcode: '',
    phone: '',
    mobile: '',
    birth_date: '',
    name_day: '',
    id_number: '',
    afm: '',
    doy: '',
    marital_status: '',
    in_office: false,
    bank_name: '',
    iban: '',
    bank_account_holder: '',
    /** In-form ιστορικό συμβάσεων (synced with hire_date/end_date). */
    periods: [],
  }
}

function str(v) {
  return v == null ? '' : String(v)
}

/** Keep only YYYY-MM-DD for date columns (safe for form + GreekDateInput). */
function dateOnly(v) {
  if (!v) return ''
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return ''
}

export function personnelFromDb(row) {
  if (!row) return emptyPersonnelForm()
  return {
    id: row.id,
    tech_id: row.tech_id || '',
    tech_name: row.tech_name || '',
    code: row.code || '',
    last_name: row.last_name || '',
    first_name: row.first_name || '',
    hire_date: dateOnly(row.hire_date),
    end_date: dateOnly(row.end_date),
    employment_type: row.employment_type || 'permanent',
    payment_method: row.payment_method || 'salary',
    admin_tech_id: row.admin_tech_id || '',
    photo_url: row.photo_url || '',
    notes: row.notes || '',
    is_active: row.is_active !== false,
    archived_at: row.archived_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    position_number: str(row.position_number),
    address: str(row.address),
    address_number: str(row.address_number),
    area: str(row.area),
    zipcode: str(row.zipcode),
    phone: str(row.phone),
    mobile: str(row.mobile),
    birth_date: dateOnly(row.birth_date),
    name_day: str(row.name_day),
    id_number: str(row.id_number),
    afm: str(row.afm),
    doy: str(row.doy),
    marital_status: str(row.marital_status),
    in_office: row.in_office === true,
    bank_name: str(row.bank_name),
    iban: str(row.iban),
    bank_account_holder: str(row.bank_account_holder),
  }
}

export function personnelToDb(form) {
  const last = String(form.last_name || '').trim()
  const first = String(form.first_name || '').trim()
  const techName =
    String(form.tech_name || '').trim() || [last, first].filter(Boolean).join(' ')

  let techId = String(form.tech_id || form.code || '').trim()
  if (!techId) techId = `D-${Date.now()}`

  const endDate = form.end_date || null
  const hasEndDate = Boolean(String(endDate || '').trim())
  const emptyToNull = (v) => {
    const s = String(v || '').trim()
    return s || null
  }

  // Λήξη γεμάτη → Απολυμένοι. Λήξη κενή → ενεργός.
  return {
    tech_id: techId,
    tech_name: techName || techId,
    code: String(form.code || techId).trim() || null,
    last_name: last || null,
    first_name: first || null,
    hire_date: form.hire_date || null,
    end_date: hasEndDate ? endDate : null,
    employment_type: form.employment_type || 'permanent',
    payment_method: form.payment_method || 'salary',
    admin_tech_id: emptyToNull(form.admin_tech_id),
    photo_url: emptyToNull(form.photo_url),
    notes: emptyToNull(form.notes),
    is_active: !hasEndDate,
    archived_at: hasEndDate ? form.archived_at || new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
    position_number: emptyToNull(form.position_number),
    address: emptyToNull(form.address),
    address_number: emptyToNull(form.address_number),
    area: emptyToNull(form.area),
    zipcode: emptyToNull(form.zipcode),
    phone: emptyToNull(form.phone),
    mobile: emptyToNull(form.mobile),
    birth_date: form.birth_date || null,
    name_day: emptyToNull(form.name_day),
    id_number: emptyToNull(form.id_number),
    afm: emptyToNull(form.afm),
    doy: emptyToNull(form.doy),
    marital_status: emptyToNull(form.marital_status),
    in_office: form.in_office === true,
    bank_name: emptyToNull(form.bank_name),
    iban: emptyToNull(form.iban),
    bank_account_holder: emptyToNull(form.bank_account_holder),
  }
}

/** Shape συμβατό με TechAnalysisModal / crewPayroll (id + name). */
export function personnelAsTech(person, adminTechs = []) {
  if (!person) return null
  const isOffice = person.in_office === true
  const adminId = isOffice ? null : person.admin_tech_id || person.tech_id
  const adminTech = isOffice
    ? null
    : (adminTechs || []).find((t) => String(t.id) === String(adminId)) ||
      (adminTechs || []).find(
        (t) => String(t.name).toLowerCase() === String(person.tech_name).toLowerCase()
      ) ||
      null

  return {
    /** DIAS tech_id — κλειδί για tech_earnings / payrolls */
    id: person.tech_id,
    /** Όνομα για engine ωρών Admin (αν υπάρχει link) */
    name: adminTech?.name || person.tech_name,
    /** Εμφάνιση DIAS */
    displayName: person.tech_name,
    initials: (person.last_name || person.tech_name || '?').slice(0, 2).toUpperCase(),
    diasId: person.id,
    code: person.code,
    last_name: person.last_name,
    first_name: person.first_name,
    hire_date: person.hire_date,
    end_date: person.end_date,
    employment_type: person.employment_type,
    payment_method: person.payment_method,
    admin_tech_id: isOffice ? null : person.admin_tech_id || (adminTech ? String(adminTech.id) : null),
    in_office: isOffice,
    photo_url: person.photo_url || adminTech?.photo_url,
    is_active: person.is_active,
    notes: person.notes,
    position_number: person.position_number,
    iban: person.iban || '',
    bank_name: person.bank_name || '',
    bank_account_holder: person.bank_account_holder || '',
    /** Admin row for hours engine */
    _adminTech: adminTech,
  }
}

/**
 * Έξτρα παροχές → στήλη Τιμολόγιο όταν payment_method είναι invoice ή mixed.
 * (Παλιό E_NEED_TIMO / υβριδικός: μισθός στα Λοιπά/Μισθό, extras στο τιμολόγιο.)
 */
export function routesExtrasToInvoice(personOrTech) {
  const method = String(personOrTech?.payment_method || '')
  return method === 'invoice' || method === 'mixed'
}

/** Εμφάνιση στήλης τιμολογίου / «κόβει παραστατικό» — ίδιο κριτήριο με extras routing. */
export function personnelIssuesInvoice(personOrTech) {
  return routesExtrasToInvoice(personOrTech)
}

export function buildFullName(lastName, firstName) {
  return [String(lastName || '').trim(), String(firstName || '').trim()]
    .filter(Boolean)
    .join(' ')
}

/** Αριθμητική θέση· null αν κενή/μη αριθμητική. */
export function parsePositionNumber(value) {
  const key = positionSortKey(value)
  if (!Number.isFinite(key) || key === Number.POSITIVE_INFINITY) return null
  return key
}

/**
 * Αν υπάρχει ήδη άλλος υπάλληλος στη θέση N, αύξησε κατά +1 όλες τις θέσεις ≥ N
 * (εκτός του τρέχοντος). Ενημερώσεις από υψηλή → χαμηλή θέση.
 */
export async function shiftPersonnelPositionsFrom({
  personnel = [],
  targetPosition,
  excludeId = null,
  client,
}) {
  const N = parsePositionNumber(targetPosition)
  if (N == null || !client) return 0

  const others = (personnel || []).filter((p) => p?.id && String(p.id) !== String(excludeId || ''))
  const conflict = others.some((p) => parsePositionNumber(p.position_number) === N)
  if (!conflict) return 0

  const toShift = others
    .map((p) => ({ id: p.id, pos: parsePositionNumber(p.position_number) }))
    .filter((p) => p.pos != null && p.pos >= N)
    .sort((a, b) => b.pos - a.pos)

  const now = new Date().toISOString()
  for (const row of toShift) {
    const { error } = await client
      .from('personnel')
      .update({
        position_number: String(row.pos + 1),
        updated_at: now,
      })
      .eq('id', row.id)
    if (error) throw error
  }
  return toShift.length
}
