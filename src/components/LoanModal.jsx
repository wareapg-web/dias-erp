import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import GreekDateInput from './GreekDateInput'
import { diasClient, formatSupabaseError } from '../lib/supabase'
import { fromElInputValue, parseElNumber, toElInputDisplay } from '../lib/numberFormat'
import { MONTH_LABELS } from '../lib/payrollAnalysis'
import { parseToIsoDate } from '../lib/greekDate'
import {
  LOAN_DISBURSEMENT_TYPE_ID,
  LOAN_INSTALLMENT_TYPE_ID,
  computeBankInstallments,
  generateLoanBatchId,
  periodAfterOffset,
} from '../lib/loanUi'

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

function formatMoneyField(n) {
  if (!Number.isFinite(n) || n === 0) return ''
  return toElInputDisplay(String(n))
}

function paymentTypeForCategory(category) {
  if (category === 'other') return 'SETTLEMENT_2'
  if (category === 'invoice') return 'SETTLEMENT'
  return 'SETTLEMENT_1'
}

/**
 * Modal δανείου / προκαταβολής — bulk insert δόσεων στο payment_entries.
 */
export default function LoanModal({
  open,
  tech,
  selectedMonth,
  analysisYear,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(() => emptyLoanForm(selectedMonth, analysisYear))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(emptyLoanForm(selectedMonth, analysisYear))
    setSaving(false)
  }, [open, selectedMonth, analysisYear, tech?.id])

  if (!open) return null

  const patch = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const applyTotalAndCount = (totalRaw, countRaw, prev) => {
    const total = parseElNumber(totalRaw)
    const count = Number(String(countRaw).replace(',', '.'))
    if (total != null && total > 0 && Number.isFinite(count) && count > 0) {
      const { baseInstallment } = computeBankInstallments(total, count)
      return {
        ...prev,
        total_amount: totalRaw,
        installment_count: countRaw,
        installment_amount: formatMoneyField(baseInstallment),
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
      if (installment != null && installment > 0 && total != null && total > 0) {
        const count = Math.max(1, Math.round(total / installment))
        const { baseInstallment } = computeBankInstallments(total, count)
        return {
          ...prev,
          installment_amount: formatMoneyField(baseInstallment),
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

  const previewTotal = parseElNumber(form.total_amount)
  const previewCount = Math.floor(Number(String(form.installment_count).replace(',', '.')))
  const { baseInstallment: previewBase, lastInstallment: previewLast } = computeBankInstallments(
    previewTotal,
    previewCount
  )
  const showLastInstallmentHint =
    previewBase != null &&
    previewLast != null &&
    previewCount > 1 &&
    Number(previewLast) !== Number(previewBase)

  const handleSave = async (e) => {
    e.preventDefault()
    if (saving) return

    const techId = tech?.id != null ? String(tech.id) : tech?.tech_id != null ? String(tech.tech_id) : null
    if (!techId) {
      toast.error('Δεν έχει επιλεγεί υπάλληλος')
      return
    }

    const totalAmount = parseElNumber(form.total_amount)
    const numberOfInstallments = Math.floor(
      Number(String(form.installment_count).replace(',', '.'))
    )
    if (totalAmount == null || totalAmount <= 0) {
      toast.error('Συμπλήρωσε έγκυρο συνολικό ποσό')
      return
    }
    if (!Number.isFinite(numberOfInstallments) || numberOfInstallments < 1) {
      toast.error('Συμπλήρωσε έγκυρο αριθμό δόσεων')
      return
    }

    const grantDate =
      parseToIsoDate(form.grant_date) ||
      (typeof form.grant_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(form.grant_date)
        ? form.grant_date.slice(0, 10)
        : null)
    if (!grantDate) {
      toast.error('Μη έγκυρη ημερομηνία χορήγησης')
      return
    }

    const startMonth = Number(form.start_month)
    const startYear = Number(form.start_year)
    if (!(startMonth >= 1 && startMonth <= 12) || !Number.isFinite(startYear)) {
      toast.error('Μη έγκυρη έναρξη αποπληρωμής')
      return
    }

    // Τραπεζική λογική: ακέραιες δόσεις 1..N-1 · η τελευταία απορροφά τη διαφορά
    const { baseInstallment, lastInstallment } = computeBankInstallments(
      totalAmount,
      numberOfInstallments
    )

    const paymentType = paymentTypeForCategory(form.category)
    const baseNotes = String(form.notes || '').trim() || 'Δάνειο'
    const techName = tech?.displayName || tech?.name || tech?.tech_name || null
    const grantMonth = Number(String(grantDate).slice(5, 7))
    const grantYear = Number(String(grantDate).slice(0, 4))
    const loanBatchId = generateLoanBatchId()

    const creditFor = (amount) => ({
      salary_credit: form.category === 'salary' ? amount : 0,
      other_credit: form.category === 'other' ? amount : 0,
      invoice_credit: form.category === 'invoice' ? amount : 0,
    })

    const entriesData = [
      {
        tech_id: techId,
        tech_name: techName,
        payment_date: grantDate,
        entry_date: grantDate,
        entry_type: paymentType,
        month: grantMonth,
        year: grantYear,
        type_id: LOAN_DISBURSEMENT_TYPE_ID,
        payment_type: paymentType,
        amount: totalAmount,
        ...creditFor(totalAmount),
        invoice_amount: 0,
        salary_debit: 0,
        other_debit: 0,
        notes: `Εκταμίευση Δανείου: ${baseNotes}`,
        description: null,
        loan_batch_id: loanBatchId,
      },
    ]

    for (let i = 0; i < numberOfInstallments; i += 1) {
      const { month: calcMonth, year: calcYear } = periodAfterOffset(startMonth, startYear, i)
      const currentInstallmentAmount =
        i === numberOfInstallments - 1 ? lastInstallment : baseInstallment
      const notes = `${baseNotes} (Δόση ${i + 1}/${numberOfInstallments})`

      entriesData.push({
        tech_id: techId,
        tech_name: techName,
        payment_date: grantDate,
        entry_date: grantDate,
        entry_type: paymentType,
        month: calcMonth,
        year: calcYear,
        type_id: LOAN_INSTALLMENT_TYPE_ID,
        payment_type: paymentType,
        amount: currentInstallmentAmount,
        ...creditFor(currentInstallmentAmount),
        invoice_amount: 0,
        salary_debit: 0,
        other_debit: 0,
        notes,
        description: null,
        loan_batch_id: loanBatchId,
      })
    }

    setSaving(true)
    try {
      const { error } = await diasClient.from('payment_entries').insert(entriesData)
      if (error) throw error
      toast.success('Η εκταμίευση και οι δόσεις καταχωρήθηκαν επιτυχώς')
      await onSaved?.({ wasPayment: true })
      onClose?.()
    } catch (err) {
      const msg =
        formatSupabaseError(err, { table: 'payment_entries', clientLabel: 'DIAS ERP' }) ||
        err?.message ||
        String(err)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const selectClass =
    'mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/40'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/20 backdrop-blur-none"
        aria-label="Κλείσιμο"
        onClick={onClose}
        disabled={saving}
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
            disabled={saving}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-slate-950/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Στοιχεία
          </p>

          <fieldset disabled={saving} className="space-y-3 disabled:opacity-60">
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
                  {showLastInstallmentHint ? (
                    <p className="mt-1 text-sm text-slate-500">
                      Η τελευταία δόση θα διαμορφωθεί στα {previewLast}€
                    </p>
                  ) : null}
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
          </fieldset>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10 disabled:opacity-50"
          >
            Ακύρωση
          </button>
          <button
            type="submit"
            disabled={!tech || saving}
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-sm font-bold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {saving ? 'Αποθήκευση...' : 'Καταχώρηση'}
          </button>
        </div>
      </form>
    </div>
  )
}
