/** Πυκνότητα γραμμών πινάκων (μήτρα, ledger, tabs) — 3 επίπεδα. */

export const ROW_DENSITY_STORAGE_KEY = 'dias-erp:row-density'

/** 0 = πιο ανοιχτό (τρέχον) · 1 = μέτριο · 2 = σφιχτό */
export const ROW_DENSITY_MAX = 2

export function loadRowDensity() {
  if (typeof window === 'undefined') return 0
  try {
    const n = Number(localStorage.getItem(ROW_DENSITY_STORAGE_KEY))
    if (n === 0 || n === 1 || n === 2) return n
  } catch {
    /* ignore */
  }
  return 0
}

export function saveRowDensity(level) {
  if (typeof window === 'undefined') return
  const n = Number(level)
  if (!(n === 0 || n === 1 || n === 2)) return
  try {
    localStorage.setItem(ROW_DENSITY_STORAGE_KEY, String(n))
  } catch {
    /* ignore */
  }
}

export function nextRowDensity(level) {
  const n = Number(level)
  const cur = n === 0 || n === 1 || n === 2 ? n : 0
  return (cur + 1) % (ROW_DENSITY_MAX + 1)
}

export const ROW_DENSITY_META = {
  0: { label: 'Ανοιχτό', short: 'Α', title: 'Πυκνότητα: ανοιχτό (τρέχον)' },
  1: { label: 'Μέτριο', short: 'Μ', title: 'Πυκνότητα: μέτριο' },
  2: { label: 'Σφιχτό', short: 'Σ', title: 'Πυκνότητα: σφιχτό' },
}

/**
 * Tailwind classes ανά επίπεδο πυκνότητας.
 * 0 = πιο ανοιχτό (όπως σήμερα).
 */
export function rowDensityStyles(level) {
  const n = Number(level)
  if (n === 2) {
    return {
      cellPy: 'py-0.5',
      cellPx: 'px-1.5',
      headPy: 'py-1',
      rowH: 'h-7',
      matrixCellPy: 'py-0.5',
      matrixLabelPy: 'py-0.5',
      tableText: 'text-[11px]',
      monoText: 'text-[10px]',
      sectionGap: 'space-y-2',
      ledgerCellPy: 'py-0.5',
    }
  }
  if (n === 1) {
    return {
      cellPy: 'py-1.5',
      cellPx: 'px-2',
      headPy: 'py-1.5',
      rowH: 'h-8',
      matrixCellPy: 'py-1',
      matrixLabelPy: 'py-1',
      tableText: 'text-xs',
      monoText: 'text-[11px]',
      sectionGap: 'space-y-2.5',
      ledgerCellPy: 'py-1',
    }
  }
  // 0 — ανοιχτό (τρέχον)
  return {
    cellPy: 'py-2.5',
    cellPx: 'px-3',
    headPy: 'py-2',
    rowH: 'h-9',
    matrixCellPy: 'py-2',
    matrixLabelPy: 'py-2',
    tableText: 'text-sm',
    monoText: 'text-[11px]',
    sectionGap: 'space-y-3',
    ledgerCellPy: 'py-1.5',
  }
}
