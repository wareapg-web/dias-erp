import React, { useEffect, useRef, useState } from 'react'
import { isoDateToGreek, maskGreekDateInput, parseToIsoDate } from '../lib/greekDate'
import PremiumGreekCalendar from './PremiumGreekCalendar'

/**
 * UI: ηη/μμ/εεεε + premium Greek calendar popover.
 * Form/DB value: YYYY-MM-DD.
 */
export default function GreekDateInput({
  value,
  onChange,
  className = '',
  disabled = false,
  withPicker = true,
}) {
  const [text, setText] = useState(() => isoDateToGreek(value))
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    setText(isoDateToGreek(value))
  }, [value])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const commit = (raw) => {
    const trimmed = String(raw || '').trim()
    if (!trimmed) {
      onChange?.('')
      setText('')
      return
    }
    const iso = parseToIsoDate(trimmed)
    if (iso) {
      onChange?.(iso)
      setText(isoDateToGreek(iso))
      return
    }
    setText(isoDateToGreek(value))
  }

  const inputClass =
    className ||
    'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white'

  const textField = (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="ηη/μμ/εεεε"
      disabled={disabled}
      value={text}
      onChange={(e) => setText(maskGreekDateInput(e.target.value))}
      onBlur={() => commit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(text)
        }
      }}
      className={withPicker ? `${inputClass} min-w-0 flex-1`.replace(/\bmt-1\b/g, '').trim() : inputClass}
    />
  )

  if (!withPicker) return textField

  const isoValue = value && /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0, 10) : ''

  return (
    <div ref={rootRef} className="relative mt-1">
      <div className="flex items-stretch gap-2">
        {textField}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          title="Επιλογή ημερομηνίας"
          aria-label="Άνοιγμα ημερολογίου"
          aria-expanded={open}
          className={`flex min-h-[42px] items-center justify-center rounded-xl border px-3 transition disabled:cursor-not-allowed disabled:opacity-50 ${
            open
              ? 'border-blue-500/50 bg-blue-600/30 text-blue-100'
              : 'border-cyan-500/35 bg-cyan-500/15 text-cyan-100 hover:border-cyan-400/50 hover:bg-cyan-500/25'
          }`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
            <path
              fillRule="evenodd"
              d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {open ? (
        <div className="absolute right-0 z-[80] mt-2">
          <PremiumGreekCalendar
            value={isoValue}
            onSelect={(iso) => {
              onChange?.(iso)
              setText(isoDateToGreek(iso))
            }}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : null}
    </div>
  )
}
