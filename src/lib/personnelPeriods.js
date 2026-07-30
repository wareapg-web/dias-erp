/**
 * Employment periods (Ιστορικό Συμβάσεων / ΠΕΡΙΟΔΟΙ).
 * Form hire_date + end_date always mirror the latest period.
 */

import { diasClient, isMissingTableError } from './supabase'

export function emptyPeriod(partial = {}) {
  return {
    id: partial.id || `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    start_date: partial.start_date || '',
    end_date: partial.end_date || '',
    employment_type: partial.employment_type || 'permanent',
    notes: partial.notes || '',
    _isNew: partial._isNew !== false && !partial.id?.match?.(/^[0-9a-f-]{36}$/i),
  }
}

export function dateOnlyIso(v) {
  if (!v) return ''
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return ''
}

/** Sort: oldest first; open-ended last among same start. */
export function sortPeriods(periods) {
  return [...(periods || [])].sort((a, b) => {
    const as = dateOnlyIso(a.start_date) || '9999-99-99'
    const bs = dateOnlyIso(b.start_date) || '9999-99-99'
    if (as !== bs) return as.localeCompare(bs)
    const ae = dateOnlyIso(a.end_date) || '9999-99-99'
    const be = dateOnlyIso(b.end_date) || '9999-99-99'
    return ae.localeCompare(be)
  })
}

/** Latest / active period = last in sorted list (most recent start). */
export function getLatestPeriod(periods) {
  const sorted = sortPeriods(periods)
  return sorted.length ? sorted[sorted.length - 1] : null
}

/** Seed one period from card hire/end when history is empty. */
export function seedPeriodsFromCard(hireDate, endDate, employmentType = 'permanent') {
  const start = dateOnlyIso(hireDate)
  const end = dateOnlyIso(endDate)
  if (!start && !end) return []
  return [
    emptyPeriod({
      start_date: start,
      end_date: end,
      employment_type: employmentType || 'permanent',
      _isNew: true,
    }),
  ]
}

/**
 * Auto-sync: write form Πρόσληψη/Λήξη into the latest period.
 * Creates a period if none exist and at least one date is set.
 */
export function syncLatestPeriodFromForm(periods, hireDate, endDate, employmentType) {
  const start = dateOnlyIso(hireDate)
  const end = dateOnlyIso(endDate)
  let list = [...(periods || [])]

  if (!list.length) {
    if (!start && !end) return []
    return seedPeriodsFromCard(start, end, employmentType)
  }

  const latest = getLatestPeriod(list)
  list = list.map((p) =>
    p.id === latest.id
      ? {
          ...p,
          start_date: start,
          end_date: end,
          employment_type: employmentType || p.employment_type || 'permanent',
        }
      : p
  )
  return list
}

/** Mirror form hire/end from latest period (after manual period edit). */
export function mirrorFormDatesFromLatest(periods) {
  const latest = getLatestPeriod(periods)
  if (!latest) return { hire_date: '', end_date: '' }
  return {
    hire_date: dateOnlyIso(latest.start_date),
    end_date: dateOnlyIso(latest.end_date),
  }
}

/**
 * Add a new open period as the latest.
 * Closes previous open period the day before new start when possible.
 */
export function addNewPeriod(periods, employmentType = 'permanent') {
  const list = sortPeriods(periods)
  const today = new Date().toISOString().slice(0, 10)
  const latest = list.length ? list[list.length - 1] : null

  if (latest && !dateOnlyIso(latest.end_date)) {
    const close = dayBefore(today) || today
    list[list.length - 1] = { ...latest, end_date: close }
  }

  list.push(
    emptyPeriod({
      start_date: today,
      end_date: '',
      employment_type: employmentType || 'permanent',
      _isNew: true,
    })
  )
  return list
}

function dayBefore(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function rangeEnd(iso) {
  return dateOnlyIso(iso) || '9999-12-31'
}

/**
 * TODO (DB): also enforce with exclusion constraint on personnel_periods.
 * Returns Greek message if any two periods overlap, else null.
 */
export function findPeriodOverlapError(periods) {
  const list = sortPeriods(periods).filter((p) => dateOnlyIso(p.start_date))
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a0 = dateOnlyIso(list[i].start_date)
      const a1 = rangeEnd(list[i].end_date)
      const b0 = dateOnlyIso(list[j].start_date)
      const b1 = rangeEnd(list[j].end_date)
      // overlap if aStart <= bEnd && bStart <= aEnd
      if (a0 <= b1 && b0 <= a1) {
        return `Επικάλυψη περιόδων: ${a0}–${dateOnlyIso(list[i].end_date) || '…'} με ${b0}–${dateOnlyIso(list[j].end_date) || '…'}. Διόρθωσε τις ημερομηνίες.`
      }
    }
  }
  return null
}

export function periodFromDb(row) {
  if (!row) return emptyPeriod()
  return {
    id: row.id,
    start_date: dateOnlyIso(row.start_date),
    end_date: dateOnlyIso(row.end_date),
    employment_type: row.employment_type || 'permanent',
    notes: row.notes || '',
    _isNew: false,
  }
}

export async function loadPersonnelPeriods(personnelId, fallbackHire, fallbackEnd, employmentType) {
  if (!personnelId) {
    return seedPeriodsFromCard(fallbackHire, fallbackEnd, employmentType)
  }
  try {
    const { data, error } = await diasClient
      .from('personnel_periods')
      .select('*')
      .eq('personnel_id', personnelId)
      .order('start_date', { ascending: true })
    if (error) throw error
    const rows = (data || []).map(periodFromDb)
    if (rows.length) return rows
    return seedPeriodsFromCard(fallbackHire, fallbackEnd, employmentType)
  } catch (err) {
    if (isMissingTableError(err)) {
      return seedPeriodsFromCard(fallbackHire, fallbackEnd, employmentType)
    }
    console.warn('loadPersonnelPeriods', err)
    return seedPeriodsFromCard(fallbackHire, fallbackEnd, employmentType)
  }
}

/** Persist periods after personnel save. No-op if table missing. */
export async function savePersonnelPeriods(personnelId, periods) {
  if (!personnelId) return { skipped: true }
  const list = sortPeriods(periods)

  try {
    const { data: existing, error: loadErr } = await diasClient
      .from('personnel_periods')
      .select('id')
      .eq('personnel_id', personnelId)
    if (loadErr) throw loadErr

    const keepIds = new Set(list.filter((p) => p.id && !String(p.id).startsWith('tmp-')).map((p) => p.id))
    const toDelete = (existing || []).map((r) => r.id).filter((id) => !keepIds.has(id))
    if (toDelete.length) {
      const { error: delErr } = await diasClient.from('personnel_periods').delete().in('id', toDelete)
      if (delErr) throw delErr
    }

    for (const p of list) {
      const payload = {
        personnel_id: personnelId,
        start_date: dateOnlyIso(p.start_date) || null,
        end_date: dateOnlyIso(p.end_date) || null,
        employment_type: p.employment_type || 'permanent',
        notes: String(p.notes || '').trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (!payload.start_date) continue

      const isTemp = !p.id || String(p.id).startsWith('tmp-')
      if (isTemp) {
        const { error } = await diasClient.from('personnel_periods').insert(payload)
        if (error) throw error
      } else {
        const { error } = await diasClient.from('personnel_periods').update(payload).eq('id', p.id)
        if (error) throw error
      }
    }
    return { ok: true }
  } catch (err) {
    if (isMissingTableError(err)) return { skipped: true, missingTable: true }
    throw err
  }
}
