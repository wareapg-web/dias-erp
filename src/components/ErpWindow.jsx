import React, { useCallback, useEffect, useRef, useState } from 'react'

const MIN_W = 720
const MIN_H = 420

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function defaultBounds() {
  const pad = 12
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = clamp(Math.round(vw - pad * 2), MIN_W, vw - pad)
  const height = clamp(Math.round(vh - pad * 2), MIN_H, vh - pad)
  return {
    x: Math.round((vw - width) / 2),
    y: Math.round((vh - height) / 2),
    width,
    height,
  }
}

/**
 * Windows-like floating window: drag title bar, resize edges/corners, maximize.
 */
export default function ErpWindow({ titleBar, children, className = '' }) {
  const [bounds, setBounds] = useState(defaultBounds)
  const [maximized, setMaximized] = useState(false)
  const restoreRef = useRef(null)
  const dragRef = useRef(null)
  const frameRef = useRef(null)

  useEffect(() => {
    const onResize = () => {
      if (maximized) return
      setBounds((b) => {
        const vw = window.innerWidth
        const vh = window.innerHeight
        const width = clamp(b.width, MIN_W, vw - 8)
        const height = clamp(b.height, MIN_H, vh - 8)
        return {
          width,
          height,
          x: clamp(b.x, 0, Math.max(0, vw - width)),
          y: clamp(b.y, 0, Math.max(0, vh - height)),
        }
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [maximized])

  const toggleMaximize = useCallback(() => {
    setMaximized((m) => {
      if (m) {
        if (restoreRef.current) setBounds(restoreRef.current)
        return false
      }
      restoreRef.current = bounds
      setBounds({
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      })
      return true
    })
  }, [bounds])

  const startDrag = useCallback(
    (e) => {
      if (maximized) return
      if (e.button !== 0) return
      if (e.target.closest('button, a, input, select, textarea')) return
      e.preventDefault()
      dragRef.current = {
        mode: 'move',
        startX: e.clientX,
        startY: e.clientY,
        orig: { ...bounds },
      }
    },
    [bounds, maximized]
  )

  const startResize = useCallback(
    (edge) => (e) => {
      if (maximized) return
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = {
        mode: 'resize',
        edge,
        startX: e.clientX,
        startY: e.clientY,
        orig: { ...bounds },
      }
    },
    [bounds, maximized]
  )

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      const vw = window.innerWidth
      const vh = window.innerHeight

      if (d.mode === 'move') {
        setBounds({
          ...d.orig,
          x: clamp(d.orig.x + dx, -d.orig.width + 120, vw - 80),
          y: clamp(d.orig.y + dy, 0, vh - 48),
        })
        return
      }

      let { x, y, width, height } = d.orig
      const edge = d.edge
      if (edge.includes('e')) width = d.orig.width + dx
      if (edge.includes('s')) height = d.orig.height + dy
      if (edge.includes('w')) {
        width = d.orig.width - dx
        x = d.orig.x + dx
      }
      if (edge.includes('n')) {
        height = d.orig.height - dy
        y = d.orig.y + dy
      }

      if (width < MIN_W) {
        if (edge.includes('w')) x = d.orig.x + d.orig.width - MIN_W
        width = MIN_W
      }
      if (height < MIN_H) {
        if (edge.includes('n')) y = d.orig.y + d.orig.height - MIN_H
        height = MIN_H
      }

      width = Math.min(width, vw - 4)
      height = Math.min(height, vh - 4)
      x = clamp(x, 0, vw - 80)
      y = clamp(y, 0, vh - 48)

      setBounds({ x, y, width, height })
    }

    const onUp = () => {
      dragRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const style = maximized
    ? { left: 0, top: 0, width: '100vw', height: '100vh', borderRadius: 0 }
    : {
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }

  const handle = (edge, cursor, extra = '') => (
    <div
      role="presentation"
      onPointerDown={startResize(edge)}
      className={`absolute z-20 ${extra}`}
      style={{ cursor }}
    />
  )

  return (
    <div
      ref={frameRef}
      className={`absolute z-10 flex flex-col overflow-hidden border border-white/15 bg-slate-950/85 shadow-2xl backdrop-blur-md ${
        maximized ? '' : 'rounded-2xl'
      } ${className}`}
      style={style}
    >
      {!maximized && (
        <>
          {handle('n', 'ns-resize', 'left-2 right-2 top-0 h-2')}
          {handle('s', 'ns-resize', 'left-2 right-2 bottom-0 h-2')}
          {handle('e', 'ew-resize', 'top-2 bottom-2 right-0 w-2')}
          {handle('w', 'ew-resize', 'top-2 bottom-2 left-0 w-2')}
          {handle('nw', 'nwse-resize', 'left-0 top-0 h-3 w-3')}
          {handle('ne', 'nesw-resize', 'right-0 top-0 h-3 w-3')}
          {handle('sw', 'nesw-resize', 'bottom-0 left-0 h-3 w-3')}
          {handle('se', 'nwse-resize', 'bottom-0 right-0 h-3 w-3')}
        </>
      )}

      <div
        className="flex shrink-0 cursor-grab items-center justify-between gap-3 border-b border-white/10 bg-slate-950/50 px-3 py-2 active:cursor-grabbing md:px-4"
        onPointerDown={startDrag}
        onDoubleClick={toggleMaximize}
      >
        <div className="min-w-0 flex-1 select-none">{titleBar}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            title={maximized ? 'Επαναφορά' : 'Μεγιστοποίηση'}
            onClick={toggleMaximize}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
          >
            {maximized ? (
              <span className="relative block h-3 w-3">
                <span className="absolute right-0 top-0 h-2.5 w-2.5 border border-current" />
                <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border border-current bg-slate-950" />
              </span>
            ) : (
              <span className="block h-3 w-3 border border-current" />
            )}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>

      {!maximized && (
        <div
          className="pointer-events-none absolute bottom-1 right-1 z-10 h-3 w-3 border-b-2 border-r-2 border-cyan-400/40"
          aria-hidden
        />
      )}
    </div>
  )
}

