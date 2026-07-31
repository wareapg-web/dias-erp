/**
 * Ελληνική μορφοποίηση αριθμών (UI: κόμμα · state/DB: τελεία).
 */

/**
 * Προβολή αριθμού με el-GR (π.χ. 1234.5 → "1.234,50").
 * @param {number|string|null|undefined} value
 * @param {{ minimumFractionDigits?: number, maximumFractionDigits?: number, empty?: string }} [opts]
 */
export function formatElNumber(value, opts = {}) {
  const {
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    empty = '',
  } = opts
  if (value === '' || value == null) return empty
  const n = typeof value === 'number' ? value : parseElNumber(value)
  if (n == null || !Number.isFinite(n)) return empty
  return new Intl.NumberFormat('el-GR', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(n)
}

/**
 * Parse από UI (κόμμα ή τελεία) → number | null.
 * Κενό / μη έγκυρο → null.
 */
export function parseElNumber(value) {
  if (value === '' || value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let s = String(value).trim().replace(/\s/g, '')
  if (!s || s === '-' || s === ',' || s === '.') return null

  // Ελληνικό: 1.234,56 → χιλιάδες ., δεκαδικό ,
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes(',')) {
    s = s.replace(',', '.')
  }

  // Trailing decimal while typing → still parse integer part
  if (s.endsWith('.')) s = s.slice(0, -1)
  if (!s || s === '-') return null

  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * State (τελεία) → κείμενο input (κόμμα). Επιτρέπει ενδιάμεσο "12," .
 */
export function toElInputDisplay(stored) {
  if (stored === '' || stored == null) return ''
  return String(stored).replace('.', ',')
}

/**
 * Κείμενο input → canonical string για React state (τελεία ως δεκαδικό).
 * Κενό → '' · επιτρέπει trailing "." για πληκτρολόγηση κόμματος.
 */
export function fromElInputValue(raw) {
  if (raw == null) return ''
  let s = String(raw).replace(/\s/g, '')
  if (!s) return ''

  const negative = s.startsWith('-')
  s = s.replace(/[^\d.,]/g, '')

  if (s.includes(',') && s.includes('.')) {
    // 1.234,56
    s = s.replace(/\./g, '')
    const i = s.indexOf(',')
    s = `${s.slice(0, i)}.${s.slice(i + 1).replace(/,/g, '')}`
  } else if (s.includes(',')) {
    const i = s.indexOf(',')
    s = `${s.slice(0, i).replace(/\./g, '')}.${s.slice(i + 1).replace(/[.,]/g, '')}`
  } else if (s.includes('.')) {
    const i = s.indexOf('.')
    s = `${s.slice(0, i)}.${s.slice(i + 1).replace(/\./g, '')}`
  }

  return `${negative ? '-' : ''}${s}`
}
