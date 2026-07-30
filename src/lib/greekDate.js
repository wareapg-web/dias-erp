/** All-caps Greek χωρίς τόνους (CSS uppercase αλλιώς αφήνει οξεία στα κεφαλαία). */
export function greekCapsLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleUpperCase('el-GR')
}

export function isoDateToGreek(iso) {
  if (!iso) return ''
  const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

function isValidYmd(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

/**
 * Accepts DD/MM/YYYY, D/M/YYYY, DD-MM-YYYY, or YYYY-MM-DD.
 * Returns ISO YYYY-MM-DD, '' for empty, or null if invalid.
 */
export function parseToIsoDate(input) {
  const s = String(input || '').trim()
  if (!s) return ''

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return isValidYmd(s) ? s : null
  }

  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  const y = Number(m[3])
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isValidYmd(iso) ? iso : null
}

/** Light mask while typing: digits + auto slashes, max ηη/μμ/εεεε. */
export function maskGreekDateInput(raw) {
  const digits = String(raw || '')
    .replace(/\D/g, '')
    .slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/** Numeric position for list sort; empty / non-numeric → last. */
export function positionSortKey(value) {
  const s = String(value ?? '').trim()
  if (!s) return Number.POSITIVE_INFINITY
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}
