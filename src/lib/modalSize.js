/** Persist resizable modal dimensions: in-memory (ίδιο session) + localStorage. */

const sizeMemory = new Map()

function resolveFallback(fallback) {
  return typeof fallback === 'function' ? fallback() : fallback
}

function clampSize(size) {
  if (!size) return null
  const width = Number(size.width)
  const height = Number(size.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 200 || height < 200) {
    return null
  }
  if (typeof window === 'undefined') {
    return { width: Math.round(width), height: Math.round(height) }
  }
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    width: Math.min(Math.max(Math.round(width), 200), vw - 24),
    height: Math.min(Math.max(Math.round(height), 200), vh - 24),
  }
}

export function loadModalSize(storageKey, fallback) {
  if (!storageKey) return resolveFallback(fallback)
  if (sizeMemory.has(storageKey)) {
    const cached = clampSize(sizeMemory.get(storageKey))
    if (cached) return cached
  }
  if (typeof window === 'undefined') return resolveFallback(fallback)
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return resolveFallback(fallback)
    const parsed = JSON.parse(raw)
    const next = clampSize(parsed)
    if (!next) return resolveFallback(fallback)
    sizeMemory.set(storageKey, next)
    return next
  } catch {
    return resolveFallback(fallback)
  }
}

export function saveModalSize(storageKey, size) {
  if (!storageKey || !size) return
  const next = clampSize(size)
  if (!next) return
  sizeMemory.set(storageKey, next)
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    /* ignore quota / private mode */
  }
}

export const PERSONNEL_FORM_MODAL_SIZE_KEY = 'dias-erp:personnel-form-modal-size'
export const PERSONNEL_CATALOG_MODAL_SIZE_KEY = 'dias-erp:personnel-catalog-modal-size'
export const PERSONNEL_SIDEBAR_WIDTH_KEY = 'dias-erp:personnel-sidebar-width'
export const MOVEMENT_MODAL_SIZE_KEY = 'dias-erp:movement-modal-size'
export const LOAN_MODAL_SIZE_KEY = 'dias-erp:loan-modal-size'
export const TEMPORARY_PAYABLES_MODAL_SIZE_KEY = 'dias-erp:temporary-payables-modal-size'

export function loadSidebarWidth(storageKey, fallback = 320) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw == null || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isFinite(n)) return fallback
    return Math.min(520, Math.max(200, Math.round(n)))
  } catch {
    return fallback
  }
}

export function saveSidebarWidth(storageKey, width) {
  if (typeof window === 'undefined' || !Number.isFinite(width)) return
  try {
    localStorage.setItem(storageKey, String(Math.round(width)))
  } catch {
    /* ignore */
  }
}
