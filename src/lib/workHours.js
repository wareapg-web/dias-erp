/**
 * Χειροκίνητες ώρες γραφείου — DIAS `work_hours`.
 * UI: ρολόι έναρξης/λήξης → δεκαδικές ώρες (στρογγυλοποίηση στο πλησιέστερο μισάωρο).
 */

import { diasClient, formatSupabaseError, isMissingTableError } from './supabase'
import { hoursBetween } from './payrollAnalysis'

/** Στρογγυλοποίηση στο πλησιέστερο μισάωρο (π.χ. 8.25 → 8.5, 8.1 → 8.0). */
export function roundToHalfHour(hours) {
  const n = Number(hours) || 0
  return Math.round(n * 2) / 2
}

/** Πλήρες έγκυρο 24h string HH:MM (00–23 : 00–59). */
export function isValidTimeHHMM(value) {
  const s = String(value || '').trim()
  if (!/^\d{2}:\d{2}$/.test(s)) return false
  const hh = Number(s.slice(0, 2))
  const mm = Number(s.slice(3, 5))
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
}

/**
 * Clamp ψηφίων ώρας θέση-θέση (HH 00–23, MM 00–59) και εισαγωγή `:`.
 */
function maskTimeDigits(digits) {
  const out = []
  for (let i = 0; i < digits.length && out.length < 4; i++) {
    const d = Number(digits[i])
    if (!Number.isFinite(d)) continue
    const pos = out.length
    if (pos === 0) {
      if (d > 2) continue
      out.push(String(d))
    } else if (pos === 1) {
      if (out[0] === '2' && d > 3) continue
      out.push(String(d))
    } else if (pos === 2) {
      if (d > 5) continue
      out.push(String(d))
    } else {
      out.push(String(d))
    }
  }

  if (out.length === 0) return ''
  if (out.length <= 2) return out.join('')
  return `${out[0]}${out[1]}:${out.slice(2).join('')}`
}

/**
 * Mask πληκτρολόγησης ώρας → canonical / ενδιάμεσο 24h string.
 * π.χ. 1430 → 14:30 · κόβει HH>23 / MM>59 · backspace/paste OK.
 */
export function maskTimeInput(raw) {
  const digits = String(raw || '')
    .replace(/\D/g, '')
    .slice(0, 4)
  if (!digits) return ''
  return maskTimeDigits(digits)
}

/**
 * Υπολογισμός ωρών από ρολόι (HH:MM) με στρογγυλοποίηση μισάωρο.
 * Τρέχει μόνο με πλήρη έγκυρα HH:MM και στα δύο άκρα.
 * @returns {{ hours: number, timeStart: string, timeEnd: string } | null}
 */
export function calcOfficeWorkedHours(timeStart, timeEnd) {
  const start = String(timeStart || '').trim()
  const end = String(timeEnd || '').trim()
  if (!isValidTimeHHMM(start) || !isValidTimeHHMM(end)) return null
  const raw = hoursBetween(start, end)
  if (raw <= 0) return { hours: 0, timeStart: start, timeEnd: end }
  return {
    hours: roundToHalfHour(raw),
    timeStart: start,
    timeEnd: end,
  }
}

/** Ημέρες μήνα ως YYYY-MM-DD. */
export function monthDateList(year, month) {
  const y = Number(year)
  const m = Number(month)
  const last = new Date(y, m, 0).getDate()
  const prefix = `${y}-${String(m).padStart(2, '0')}`
  return Array.from({ length: last }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`)
}

export function emptyManualDay() {
  return { time_start: '', time_end: '', worked_hours: 0 }
}

/**
 * @returns {Promise<{ byDate: Record<string, { time_start: string, time_end: string, worked_hours: number }>, missingTable: boolean, error: string|null }>}
 */
export async function loadWorkHours({ techId, year, month }) {
  if (!techId) {
    return { byDate: {}, missingTable: false, error: null }
  }
  const dates = monthDateList(year, month)
  const from = dates[0]
  const to = dates[dates.length - 1]

  const { data, error } = await diasClient
    .from('work_hours')
    .select('work_date, time_start, time_end, worked_hours')
    .eq('tech_id', String(techId))
    .gte('work_date', from)
    .lte('work_date', to)

  if (error) {
    return {
      byDate: {},
      missingTable: isMissingTableError(error),
      error: formatSupabaseError(error, { table: 'work_hours', clientLabel: 'DIAS ERP' }),
    }
  }

  const byDate = {}
  for (const row of data || []) {
    const d = String(row.work_date || '').slice(0, 10)
    if (!d) continue
    byDate[d] = {
      time_start: row.time_start || '',
      time_end: row.time_end || '',
      worked_hours: Number(row.worked_hours) || 0,
    }
  }
  return { byDate, missingTable: false, error: null }
}

/**
 * Upsert μόνο ημερών με πλήρη έγκυρα HH:MM (καθαρή βάση).
 */
export async function upsertWorkHours({ techId, days }) {
  if (!techId) throw new Error('Δεν έχει επιλεγεί υπάλληλος')
  const now = new Date().toISOString()
  const rows = []
  for (const [work_date, day] of Object.entries(days || {})) {
    const time_start = String(day?.time_start || '').trim()
    const time_end = String(day?.time_end || '').trim()
    if (!isValidTimeHHMM(time_start) || !isValidTimeHHMM(time_end)) continue

    const calc = calcOfficeWorkedHours(time_start, time_end)
    const worked_hours = calc?.hours ?? 0
    if (worked_hours <= 0) continue

    rows.push({
      tech_id: String(techId),
      work_date,
      time_start,
      time_end,
      worked_hours,
      updated_at: now,
    })
  }
  if (!rows.length) {
    return { saved: 0 }
  }

  const { error } = await diasClient.from('work_hours').upsert(rows, {
    onConflict: 'tech_id,work_date',
  })
  if (error) {
    const msg = formatSupabaseError(error, { table: 'work_hours', clientLabel: 'DIAS ERP' })
    const err = new Error(msg)
    err.missingTable = isMissingTableError(error)
    throw err
  }
  return { saved: rows.length }
}
