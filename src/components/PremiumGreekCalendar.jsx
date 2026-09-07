import React, { useEffect, useMemo, useState } from 'react'
import { MONTH_LABELS } from '../lib/payrollAnalysis'

const WEEKDAYS = ['ΔΕ', 'ΤΡ', 'ΤΕ', 'ΠΕ', 'ΠΑ', 'ΣΑ', 'ΚΥ']

function toIso(y, m0, d) {
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseIsoParts(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return { y: Number(m[1]), m0: Number(m[2]) - 1, d: Number(m[3]) }
}

/** Δευτέρα ως αρχή εβδομάδας (μόνο για layout grid). */
function startOfWeekMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  d.setDate(d.getDate() - day)
  return d
}

function isSameDay(a, b) {
  return (
    a &&
    b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Premium dark calendar — ελληνικά, highlight μόνο της επιλεγμένης ημέρας.
 * value/onSelect: ISO YYYY-MM-DD
 */
export default function PremiumGreekCalendar({ value = '', onSelect, onClose }) {
  const selected = parseIsoParts(value)
  const initial = selected || {
    y: new Date().getFullYear(),
    m0: new Date().getMonth(),
    d: new Date().getDate(),
  }

  const [viewY, setViewY] = useState(initial.y)
  const [viewM0, setViewM0] = useState(initial.m0)

  useEffect(() => {
    if (!selected) return
    setViewY(selected.y)
    setViewM0(selected.m0)
  }, [value])

  const selectedDate = selected
    ? new Date(selected.y, selected.m0, selected.d)
    : null

  const today = useMemo(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), n.getDate())
  }, [])

  const cells = useMemo(() => {
    const first = new Date(viewY, viewM0, 1)
    const start = startOfWeekMonday(first)
    const list = []
    for (let i = 0; i < 42; i += 1) {
      const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      list.push(dt)
    }
    return list
  }, [viewY, viewM0])

  const shiftMonth = (delta) => {
    const d = new Date(viewY, viewM0 + delta, 1)
    setViewY(d.getFullYear())
    setViewM0(d.getMonth())
  }

  const title = `${MONTH_LABELS[viewM0] || ''} ${viewY}`

  return (
    <div
      role="dialog"
      aria-label="Επιλογή ημερομηνίας"
      className="w-[300px] rounded-2xl border border-white/10 bg-slate-800 p-4 shadow-2xl shadow-black/50"
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-slate-900/80 text-slate-200 transition hover:border-white/20 hover:bg-slate-700"
          aria-label="Προηγούμενος μήνας"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
            <path
              fillRule="evenodd"
              d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <p className="text-base font-bold tracking-tight text-white">{title}</p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-slate-900/80 text-slate-200 transition hover:border-white/20 hover:bg-slate-700"
          aria-label="Επόμενος μήνας"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((dt) => {
          const inMonth = dt.getMonth() === viewM0
          const iso = toIso(dt.getFullYear(), dt.getMonth(), dt.getDate())
          const selectedDay = isSameDay(dt, selectedDate)
          const isToday = isSameDay(dt, today)

          let cellClass =
            'relative flex h-9 items-center justify-center rounded-lg text-sm font-semibold transition '
          if (selectedDay) {
            cellClass += 'bg-blue-600 text-white shadow-md shadow-blue-600/40 '
          } else if (inMonth) {
            cellClass += 'text-white hover:bg-slate-700/80 '
            if (isToday) cellClass += 'ring-1 ring-inset ring-blue-400/50 '
          } else {
            cellClass += 'text-slate-600 hover:bg-slate-700/40 hover:text-slate-400 '
          }

          return (
            <button
              key={iso}
              type="button"
              onClick={() => {
                onSelect?.(iso)
                onClose?.()
              }}
              className={cellClass}
            >
              {dt.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
