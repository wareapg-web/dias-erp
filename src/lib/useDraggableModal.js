import { useCallback, useEffect, useRef, useState } from 'react'

/** In-memory cache (ίδιο session) + localStorage (επόμενα ανοίγματα). */
const memoryCache = new Map()

export const MODAL_POS_KEYS = {
  movement: 'dias-erp:modal-pos:movement',
  movementLoanDelete: 'dias-erp:modal-pos:movement-loan-delete',
  loan: 'dias-erp:modal-pos:loan',
  loanMgmtDelete: 'dias-erp:modal-pos:loan-mgmt-delete',
  personnelForm: 'dias-erp:modal-pos:personnel-form',
  personnelCatalog: 'dias-erp:modal-pos:personnel-catalog',
  settings: 'dias-erp:modal-pos:settings',
  techAnalysis: 'dias-erp:modal-pos:tech-analysis',
  loanMgmtWindow: 'dias-erp:modal-pos:loan-mgmt-window',
  temporaryPayables: 'dias-erp:modal-pos:temporary-payables',
}

function clampOffset(x, y) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  // κράτα λίγο μέσα στο viewport ακόμα κι αν τραβήξει μακριά
  const maxX = Math.max(vw * 0.45, 120)
  const maxY = Math.max(vh * 0.45, 80)
  return {
    x: Math.min(maxX, Math.max(-maxX, Math.round(Number(x) || 0))),
    y: Math.min(maxY, Math.max(-maxY, Math.round(Number(y) || 0))),
  }
}

export function loadModalOffset(storageKey) {
  if (!storageKey) return { x: 0, y: 0 }
  if (memoryCache.has(storageKey)) {
    return clampOffset(memoryCache.get(storageKey).x, memoryCache.get(storageKey).y)
  }
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { x: 0, y: 0 }
    const parsed = JSON.parse(raw)
    const next = clampOffset(parsed?.x, parsed?.y)
    memoryCache.set(storageKey, next)
    return next
  } catch {
    return { x: 0, y: 0 }
  }
}

export function saveModalOffset(storageKey, offset) {
  if (!storageKey || !offset) return
  const next = clampOffset(offset.x, offset.y)
  memoryCache.set(storageKey, next)
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

/**
 * Σύρε από τη γραμμή τίτλου για μετακίνηση modal.
 * Με storageKey: κρατάει θέση σε μνήμη + localStorage (δεν μηδενίζει στο κλείσιμο).
 *
 * @param {boolean} [active=true]
 * @param {string|null} [storageKey=null]
 */
export function useDraggableModal(active = true, storageKey = null) {
  const [offset, setOffset] = useState(() => loadModalOffset(storageKey))
  const dragRef = useRef(null)
  const offsetRef = useRef(offset)
  offsetRef.current = offset

  useEffect(() => {
    if (!active) return
    setOffset(loadModalOffset(storageKey))
  }, [active, storageKey])

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return
      const next = clampOffset(
        d.originX + (e.clientX - d.startX),
        d.originY + (e.clientY - d.startY)
      )
      setOffset(next)
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      saveModalOffset(storageKey, offsetRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [storageKey])

  const onDragHandlePointerDown = useCallback(
    (e) => {
      if (e.button !== 0) return
      if (e.target.closest('button, a, input, select, textarea, label')) return
      e.preventDefault()
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: offset.x,
        originY: offset.y,
      }
    },
    [offset]
  )

  return {
    panelStyle: {
      transform: `translate(${offset.x}px, ${offset.y}px)`,
    },
    dragHandleProps: {
      onPointerDown: onDragHandlePointerDown,
    },
    dragHandleClassName: 'cursor-grab select-none active:cursor-grabbing',
  }
}
