import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Dark-theme dropdown — menu via portal + position:fixed (δεν σπρώχνει layout).
 */
export default function DarkSelect({
  value,
  onChange,
  options = [],
  id,
  disabled = false,
  className = '',
  placeholder = '—',
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [coords, setCoords] = useState(null)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const autoId = useId()
  const triggerId = id || autoId

  const updateCoords = () => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gap = 8
    const maxH = 240
    const spaceBelow = window.innerHeight - r.bottom - gap
    const openUp = spaceBelow < 120 && r.top > spaceBelow
    setCoords({
      left: r.left,
      width: Math.max(r.width, 140),
      maxH,
      openUp,
      top: openUp ? undefined : r.bottom + gap,
      bottom: openUp ? window.innerHeight - r.top + gap : undefined,
    })
  }

  useLayoutEffect(() => {
    if (!isOpen) {
      setCoords(null)
      return
    }
    updateCoords()
    const onReposition = () => updateCoords()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (e) => {
      const t = e.target
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setIsOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen])

  useEffect(() => {
    if (disabled) setIsOpen(false)
  }, [disabled])

  const selected = options.find((o) => String(o.value) === String(value))
  const label = selected?.label ?? placeholder

  const pick = (opt) => {
    onChange?.(opt.value)
    setIsOpen(false)
  }

  const menu =
    isOpen && coords && typeof document !== 'undefined'
      ? createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            aria-labelledby={triggerId}
            className="dark-select-menu fixed z-[100] overflow-y-auto rounded-xl border border-slate-600 bg-[#1e293b] py-1.5 shadow-2xl shadow-black/50"
            style={{
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxH,
              top: coords.top,
              bottom: coords.bottom,
            }}
            onMouseDown={(e) => {
              // Μην αφήσεις το click να «πέσει» στο matrix από κάτω
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {options.length === 0 ? (
              <li className="px-4 py-2 text-sm text-slate-500">{placeholder}</li>
            ) : (
              options.map((opt) => {
                const active = String(opt.value) === String(value)
                return (
                  <li key={String(opt.value)}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        pick(opt)
                      }}
                      className={`flex w-full cursor-pointer px-4 py-2 text-left text-sm font-bold tracking-wide transition-colors duration-150 ${
                        active
                          ? 'bg-amber-400/90 text-slate-950'
                          : 'text-slate-200 hover:bg-[#334155]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  </li>
                )
              })
            )}
          </ul>,
          document.body
        )
      : null

  return (
    <>
      <div ref={rootRef} className={`relative ${className}`}>
        <button
          ref={triggerRef}
          type="button"
          id={triggerId}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => {
            if (!disabled) setIsOpen((o) => !o)
          }}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left text-sm font-bold tracking-wide text-white transition hover:border-slate-600 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="min-w-0 truncate">{label}</span>
          <svg
            className={`h-4 w-4 shrink-0 text-slate-400 transition duration-150 ${isOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
      {menu}
    </>
  )
}
