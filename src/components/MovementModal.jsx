import React, { useEffect, useMemo, useState } from 'react'
import { diasClient, formatSupabaseError } from '../lib/supabase'
import { movementFormFromRow, parseMovementAmount } from '../lib/techLedger'
import {
  isPaymentTypePay,
  isSalaryColIndex,
  paymentTypeCodeFromDescription,
  payrollTypeCodeFromDescription,
} from '../lib/transactionTypes'

/**
 * Κίνηση modal — 100% data-driven από transaction_types (όχι hardcoded lists).
 */
export default function MovementModal({
  open,
  selectedRowData,
  tech,
  onClose,
  onSaved,
  error: externalError = null,
}) {
  const [form, setForm] = useState(() => movementFormFromRow(null))
  const [types, setTypes] = useState([])
  const [typesLoading, setTypesLoading] = useState(false)
  const [typesError, setTypesError] = useState(null)
  const [selectedTypeId, setSelectedTypeId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const isEdit = Boolean(selectedRowData?.id)
  const rowSource = selectedRowData?.source || 'PAYROLL'

  useEffect(() => {
    if (!open) return
    setForm(movementFormFromRow(selectedRowData))
    setTypesError(null)
    setSaveError(null)

    let cancelled = false
    async function loadTypes() {
      setTypesLoading(true)
      try {
        const { data, error: err } = await diasClient
          .from('transaction_types')
          .select('id, description, type_pay, col_index, is_for_sum, sort_order, is_active')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true })

        if (cancelled) return
        if (err) throw err

        const list = data || []
        setTypes(list)

        if (selectedRowData?.type) {
          const match =
            list.find((t) => t.description === selectedRowData.type) ||
            list.find(
              (t) =>
                String(t.description).toLowerCase() ===
                String(selectedRowData.type).toLowerCase()
            )
          setSelectedTypeId(match?.id ?? list[0]?.id ?? null)
          if (match) {
            setForm((prev) => ({
              ...prev,
              type: match.description,
              is_salary_type: isSalaryColIndex(match.col_index),
            }))
          }
        } else {
          const first = list[0]
          setSelectedTypeId(first?.id ?? null)
          if (first) {
            setForm((prev) => ({
              ...prev,
              type: first.description,
              is_salary_type: isSalaryColIndex(first.col_index),
            }))
          }
        }
      } catch (err) {
        if (!cancelled) {
          setTypes([])
          setTypesError(
            formatSupabaseError(err, { table: 'transaction_types', clientLabel: 'DIAS ERP' }) ||
              err.message ||
              'Λείπει το transaction_types — τρέξε supabase/06_transaction_types.sql'
          )
        }
      } finally {
        if (!cancelled) setTypesLoading(false)
      }
    }

    loadTypes()
    return () => {
      cancelled = true
    }
  }, [open, selectedRowData])

  const selectedType = useMemo(
    () => types.find((t) => Number(t.id) === Number(selectedTypeId)) || null,
    [types, selectedTypeId]
  )

  if (!open) return null

  const patch = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const handleTypeChange = (typeId) => {
    const id = Number(typeId)
    setSelectedTypeId(id)
    const t = types.find((x) => Number(x.id) === id)
    if (!t) return
    setForm((prev) => ({
      ...prev,
      type: t.description,
      is_salary_type: isSalaryColIndex(t.col_index),
    }))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaveError(null)

    if (typesLoading || !selectedType) {
      setSaveError(typesLoading ? 'Περίμενε φόρτωση τύπων...' : 'Επίλεξε τύπο κίνησης')
      return
    }
    if (!tech?.id) {
      setSaveError('Δεν έχει επιλεγεί υπάλληλος')
      return
    }

    let amount
    try {
      amount = parseMovementAmount(form.amount)
    } catch (err) {
      setSaveError(err.message || String(err))
      return
    }

    setSaving(true)
    try {
      if (isEdit) {
        // Επεξεργασία: ενημέρωση στο table της υπάρχουσας γραμμής (source από ledger)
        if (rowSource === 'PAYMENT') {
          const paymentType = paymentTypeCodeFromDescription(selectedType.description)
          const { error } = await diasClient
            .from('payment_entries')
            .update({
              payment_date: form.entry_date,
              payment_type: paymentType,
              amount,
              notes: form.notes?.trim() || form.description?.trim() || null,
              entry_date: form.entry_date,
              entry_type: paymentType,
              description: form.description?.trim() || selectedType.description,
              tech_name: tech.displayName || tech.name || null,
            })
            .eq('id', selectedRowData.id)
          if (error) throw error
        } else {
          const { error } = await diasClient
            .from('payroll_entries')
            .update({
              reference_date: form.entry_date,
              type_code: payrollTypeCodeFromDescription(selectedType.description),
              description: form.description?.trim() || null,
              amount,
              is_salary_type: isSalaryColIndex(selectedType.col_index),
            })
            .eq('id', selectedRowData.id)
          if (error) throw error
        }
      } else {
        // Create Mode — 100% από transaction_types
        // type_pay === 1 → payroll_entries · type_pay === 2 → payment_entries
        if (Number(selectedType.type_pay) === 1) {
          const { error } = await diasClient.from('payroll_entries').insert({
            tech_id: String(tech.id),
            reference_date: form.entry_date,
            type_code: payrollTypeCodeFromDescription(selectedType.description),
            description: form.description?.trim() || null,
            amount,
            is_salary_type: Number(selectedType.col_index) === 1,
          })
          if (error) throw error
        } else if (Number(selectedType.type_pay) === 2) {
          const paymentType = paymentTypeCodeFromDescription(selectedType.description)
          const { error } = await diasClient.from('payment_entries').insert({
            tech_id: String(tech.id),
            tech_name: tech.displayName || tech.name || null,
            payment_date: form.entry_date,
            payment_type: paymentType,
            amount,
            notes: form.notes?.trim() || form.description?.trim() || null,
            entry_date: form.entry_date,
            entry_type: paymentType,
            description: form.description?.trim() || selectedType.description,
          })
          if (error) throw error
        } else {
          throw new Error(
            `Άγνωστο type_pay=${selectedType.type_pay}. Αναμενόμενο 1 (χρέωση) ή 2 (πίστωση).`
          )
        }
      }

      onSaved?.({
        wasPayment:
          isEdit
            ? rowSource === 'PAYMENT'
            : Number(selectedType.type_pay) === 2,
      })
      onClose?.()
    } catch (err) {
      const table =
        isEdit
          ? rowSource === 'PAYMENT'
            ? 'payment_entries'
            : 'payroll_entries'
          : Number(selectedType?.type_pay) === 2
            ? 'payment_entries'
            : 'payroll_entries'
      setSaveError(
        formatSupabaseError(err, { table, clientLabel: 'DIAS ERP' }) ||
          err.message ||
          String(err)
      )
    } finally {
      setSaving(false)
    }
  }

  const createTargetIsPayment = selectedType && Number(selectedType.type_pay) === 2
  const displayError = saveError || externalError
  const formDisabled = typesLoading || types.length === 0 || saving

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
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
            <h3 className="text-lg font-bold text-white">Κίνηση</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {typesLoading
                ? 'Φόρτωση τύπων από transaction_types...'
                : isEdit
                  ? `Επεξεργασία · ${rowSource === 'PAYMENT' ? 'Πληρωμή' : 'Δεδουλευμένο'}`
                  : createTargetIsPayment
                    ? 'Νέα πίστωση → payment_entries (type_pay=2)'
                    : 'Νέα χρέωση → payroll_entries (type_pay=1)'}
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
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Στοιχεία</p>

          {(typesError || typesLoading) && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                typesError
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                  : 'border-white/10 bg-white/5 text-slate-400'
              }`}
            >
              {typesError || 'Φόρτωση τύπων από Supabase...'}
            </div>
          )}

          <fieldset disabled={formDisabled} className="space-y-3 disabled:opacity-60">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Ημερομηνία
                </label>
                <input
                  type="date"
                  value={form.entry_date || ''}
                  onChange={(e) => patch('entry_date', e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Τύπος
                </label>
                <select
                  value={selectedTypeId ?? ''}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                >
                  {types.length === 0 ? (
                    <option value="">—</option>
                  ) : (
                    types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.description}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Περιγραφή
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder="π.χ. 20.00 ώρα/ες x 15.00 €"
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-600"
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Ποσό (€)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={form.amount}
                onChange={(e) => patch('amount', e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white"
              />
            </div>

            {selectedType && !typesLoading && (
              <p className="text-[11px] text-slate-500">
                id={selectedType.id} · type_pay={selectedType.type_pay} · col_index=
                {selectedType.col_index} ·{' '}
                {Number(selectedType.col_index) === 1 ? 'Μισθός' : 'Λοιπά'} ·{' '}
                {Number(selectedType.type_pay) === 2 ? 'Πίστωση' : 'Χρέωση'}
              </p>
            )}

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Σημειώσεις
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => patch('notes', e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
              />
            </div>
          </fieldset>
        </div>

        {displayError && (
          <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {displayError}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={formDisabled}
            className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2.5 text-sm font-bold text-emerald-100 disabled:opacity-50"
          >
            {saving ? 'Αποθήκευση...' : typesLoading ? 'Φόρτωση...' : 'Αποθήκευση'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-2.5 text-sm font-bold text-rose-100 disabled:opacity-50"
          >
            Έξοδος
          </button>
        </div>
      </form>
    </div>
  )
}
