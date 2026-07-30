/** Persist resizable modal dimensions across sessions. */

export function loadModalSize(storageKey, fallback) {
  if (typeof window === 'undefined') {
    return typeof fallback === 'function' ? fallback() : fallback
  }
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return typeof fallback === 'function' ? fallback() : fallback
    const parsed = JSON.parse(raw)
    const width = Number(parsed?.width)
    const height = Number(parsed?.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 200 || height < 200) {
      return typeof fallback === 'function' ? fallback() : fallback
    }
    const vw = window.innerWidth
    const vh = window.innerHeight
    return {
      width: Math.min(Math.max(width, 200), vw - 24),
      height: Math.min(Math.max(height, 200), vh - 24),
    }
  } catch {
    return typeof fallback === 'function' ? fallback() : fallback
  }
}

export function saveModalSize(storageKey, size) {
  if (typeof window === 'undefined' || !size) return
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ width: Math.round(size.width), height: Math.round(size.height) })
    )
  } catch {
    /* ignore quota / private mode */
  }
}

export const PERSONNEL_FORM_MODAL_SIZE_KEY = 'dias-erp:personnel-form-modal-size'
export const PERSONNEL_CATALOG_MODAL_SIZE_KEY = 'dias-erp:personnel-catalog-modal-size'
