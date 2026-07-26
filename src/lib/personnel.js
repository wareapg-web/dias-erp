/** DIAS personnel (HR master) — mapping & helpers */

export const EMPLOYMENT_TYPES = [
  { value: 'permanent', label: 'Μόνιμος' },
  { value: 'temporary', label: 'Έκτακτος' },
  { value: 'contractor', label: 'Συνεργάτης' },
]

export const PAYMENT_METHODS = [
  { value: 'salary', label: 'Μισθός (χωρίς τιμολόγιο)' },
  { value: 'invoice', label: 'Με τιμολόγιο' },
  { value: 'mixed', label: 'Μικτό' },
]

export function employmentLabel(value) {
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
  }
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
    hire_date: row.hire_date || '',
    end_date: row.end_date || '',
    employment_type: row.employment_type || 'permanent',
    payment_method: row.payment_method || 'salary',
    admin_tech_id: row.admin_tech_id || '',
    photo_url: row.photo_url || '',
    notes: row.notes || '',
    is_active: row.is_active !== false,
    archived_at: row.archived_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function personnelToDb(form) {
  const last = String(form.last_name || '').trim()
  const first = String(form.first_name || '').trim()
  const techName =
    String(form.tech_name || '').trim() || [last, first].filter(Boolean).join(' ')

  let techId = String(form.tech_id || form.code || '').trim()
  if (!techId) techId = `D-${Date.now()}`

  return {
    tech_id: techId,
    tech_name: techName || techId,
    code: String(form.code || techId).trim() || null,
    last_name: last || null,
    first_name: first || null,
    hire_date: form.hire_date || null,
    end_date: form.end_date || null,
    employment_type: form.employment_type || 'permanent',
    payment_method: form.payment_method || 'salary',
    admin_tech_id: String(form.admin_tech_id || '').trim() || null,
    photo_url: String(form.photo_url || '').trim() || null,
    notes: String(form.notes || '').trim() || null,
    is_active: form.is_active !== false,
    updated_at: new Date().toISOString(),
  }
}

/** Shape συμβατό με TechAnalysisModal / crewPayroll (id + name). */
export function personnelAsTech(person, adminTechs = []) {
  if (!person) return null
  const adminId = person.admin_tech_id || person.tech_id
  const adminTech =
    (adminTechs || []).find((t) => String(t.id) === String(adminId)) ||
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
    admin_tech_id: person.admin_tech_id || (adminTech ? String(adminTech.id) : null),
    photo_url: person.photo_url || adminTech?.photo_url,
    is_active: person.is_active,
    notes: person.notes,
    /** Admin row for hours engine */
    _adminTech: adminTech,
  }
}

export function buildFullName(lastName, firstName) {
  return [String(lastName || '').trim(), String(firstName || '').trim()]
    .filter(Boolean)
    .join(' ')
}
