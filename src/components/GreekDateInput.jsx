import React, { useEffect, useState } from 'react'
import { isoDateToGreek, maskGreekDateInput, parseToIsoDate } from '../lib/greekDate'

/**
 * UI: ηη/μμ/εεεε. Form/DB value: YYYY-MM-DD.
 */
export default function GreekDateInput({ value, onChange, className = '', disabled = false }) {
  const [text, setText] = useState(() => isoDateToGreek(value))

  useEffect(() => {
    setText(isoDateToGreek(value))
  }, [value])

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
    // Invalid → keep previous ISO value / display (don't corrupt form state)
    setText(isoDateToGreek(value))
  }

  return (
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
      className={className}
    />
  )
}
