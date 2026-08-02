import React, { useEffect, useState } from 'react'
import GreekDateInput from './GreekDateInput'
import { fromElInputValue, parseElNumber, toElInputDisplay } from '../lib/numberFormat'
import { MONTH_LABELS } from '../lib/payrollAnalysis'

const CATEGORY_OPTIONS = [
  { value: 'salary', label: 'Μισθός' },
  { value: 'other', label: 'Λοιπά' },
  { value: 'invoice', label: 'Τιμολόγιο' },
]

function emptyLoanForm(month, year) {
  return {
    grant_date: new Date().toISOString().slice(0, 10),
    total_amount: '',
    start_month: Number(month) || new Date().getMonth() + 1,
    start_year: Number(year) || new Date().getFullYear(),
    installment_count: '',
    installment_amount: '',
    category: 'salary',
    notes: '',
  }
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function formatMoneyField(n) {
  if (!Number.isFinite(n) || n === 0) return ''
  return toElInputDisplay(String(n))
}

/**
 * Modal δανείου / προκαταβολής — UI only (save → console.log).
 */
export default function LoanModal({
  open,
  tech,
  selectedMonth,
  analysisYear,
  onClose,
}) {
  const [form, setForm] = useState(() => emptyLoanForm(selectedMonth, analysisYear))

  useEffect(() => {
    if (!open) return
    setForm(emptyLoanForm(selectedMonth, analysisYear))
  }, [open, selectedMonth, analysisYear, tech?.id])

  if (!open) return null

  const patch = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const applyTotalAndCount = (totalRaw, countRaw, prev) => {
    const total = parseElNumber(totalRaw)
    const count = Number(String(countRaw).replace(',', '.'))
    if (total != null && total > 0 && Number.isFinite(count) && count > 0) {
      return {
        ...prev,
        total_amount: totalRaw,
        installment_count: countRaw,
        installment_amount: formatMoneyField(roundMoney(total / count)),
      }
    }
    return { ...prev, total_amount: totalRaw, installment_count: countRaw }
  }

  const handleTotalChange = (raw) => {
    setForm((prev) => applyTotalAndCount(raw, prev.installment_count, prev))
  }

  const handleCountChange = (raw) => {
    setForm((prev) => applyTotalAndCount(prev.total_amount, raw, prev))
  }

  const handleInstallmentChange = (raw) => {
    setForm((prev) => {
      const installment = parseElNumber(raw)
      const total = parseElNumber(prev.total_amount)
      if (
        installment != null &&
        installment > 0 &&
        total != null &&
        total > 0
      ) {
        const count = Math.max(1, Math.round(total / installment))
        return {
          ...prev,
          installment_amount: raw,
          installment_count: String(count),
        }
      }
      return { ...prev, installment_amount: raw }
    })
  }

  const yearOptions = (() => {
    const base = Number(analysisYear) || new Date().getFullYear()
    const years = []
    for (let y = base - 1; y <= base + 5; y += 1) years.push(y)
    return years
  })()

  const handleSave = (e) => {
    e.preventDefault()
    const total = parseElNumber(form.total_amount)
    const installment = parseElNumber(form.installment_amount)
    const count = Number(String(form.installment_count).replace(',', '.'))
    const payload = {
      tech_id: tech?.id != null ? String(tech.id) : null,
      tech_name: tech?.displayName || tech?.name || null,
      grant_date: form.grant_date,
      total_amount: total,
      start_month: Number(form.start_month),
      start_year: Number(form.start_year),
      installment_count: Number.isFinite(count) ? count : null,
      installment_amount: installment,
      category: form.category,
      notes: String(form.notes || '').trim() || null,
    }
    console.log('[LoanModal] payload', payload)
    onClose?.()
  }

  const selectClass =
    'mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/40'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[1px]"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <form
        onSubmit={handleSave}
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Καρτέλα
            </p>
            <h3 className="text-lg font-bold text-white">Δάνειο / Προκαταβολή</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {tech?.displayName || tech?.name
                ? `Νέα χορήγηση · ${tech.displayName || tech.name}`
                : 'Νέα χορήγηση δανείου'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-300 hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-slate-950/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Στοιχεία
          </p>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Ημερομηνία Χορήγησης
            </label>
            <GreekDateInput
              value={form.grant_date || ''}
              onChange={(iso) => patch('grant_date', iso)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Συνολικό Ποσό (€)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={toElInputDisplay(form.total_amount)}
              onChange={(e) => handleTotalChange(fromElInputValue(e.target.value))}
              placeholder="0,00"
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Έναρξη Αποπληρωμής
            </label>
            <div className="mt-1 grid grid-cols-2 gap-3">
              <select
                value={form.start_month}
                onChange={(e) => patch('start_month', Number(e.target.value))}
                className={selectClass}
              >
                {MONTH_LABELS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={form.start_year}
                onChange={(e) => patch('start_year', Number(e.target.value))}
                className={selectClass}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Δοσολόγιο
            </label>
            <div className="mt-1 flex flex-col gap-3 sm:flex-row">
              <div className="min-w-0 flex-1">
                <label className="text-[10px] text-slate-500">Αριθμός Δόσεων</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.installment_count}
                  onChange={(e) => handleCountChange(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="π.χ. 10"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600"
                />
              </div>
              <div className="min-w-0 flex-1">
                <label className="text-[10px] text-slate-500">Ποσό Δόσης (€)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={toElInputDisplay(form.installment_amount)}
                  onChange={(e) => handleInstallmentChange(fromElInputValue(e.target.value))}
                  placeholder="αυτόματα"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Κατηγορία Κράτησης
            </label>
            <select
              value={form.category}
              onChange={(e) => patch('category', e.target.value)}
              className={selectClass}
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Αιτιολογία / Σημειώσεις
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => patch('notes', e.target.value)}
              rows={2}
              placeholder="π.χ. Δάνειο για αγορά αυτοκινήτου"
              className="mt-1 w-full resize-y rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10"
          >
            Ακύρωση
          </button>
          <button
            type="submit"
            disabled={!tech}
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-sm font-bold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            Καταχώρηση
          </button>
        </div>
      </form>
    </div>
  )
}
