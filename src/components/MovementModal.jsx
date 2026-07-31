import React, { useEffect, useMemo, useState } from 'react'
import { diasClient, formatSupabaseError } from '../lib/supabase'
import { movementFormFromRow, parseMovementAmount, extractLedgerAmount, isBareEuroText } from '../lib/techLedger'
import { fromElInputValue, toElInputDisplay } from '../lib/numberFormat'
import {
  resolveLedgerColumn,
  resolveLedgerSide,
} from '../lib/ledgerMapping'
import {
  buildTypeLookup,
  isSalaryLedgerGroup,
  ledgerColumnFor,
  ledgerColumnLabel,
  ledgerGroupLabel,
  paymentTypeCodeFromDescription,
  payrollTypeCodeFromDescription,
  resolveTransactionTypeFromLedgerRow,
  shouldPostAsPayment,
  sideFromLedgerBucket,
} from '../lib/transactionTypes'

/**
 * Κίνηση modal — data-driven από transaction_types.
 * ledger_group (SALARY|OTHER) → Μισθός vs Λοιπά columns.
 * side (DEBIT|CREDIT) → Χρέωση vs Πίστωση (UI choice, not locked by type).
 */
export default function MovementModal({
  open,
  selectedRowData,
  tech,
  presetTypeId = null,
  presetSide = null,
  presetDescription = null,
  presetAmount = null,
  hasInvoice = false,
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

  const typeIsSalary = (t) => {
    if (!t) return false
    if (t.ledger_group) return isSalaryLedgerGroup(t.ledger_group)
    return Number(t.col_index) === 1
  }

  const applyType = (t, sideOverride) => {
    if (!t) return
    const side = sideOverride || resolveLedgerSide(t, 0, {})
    const salary = typeIsSalary(t)
    setForm((prev) => ({
      ...prev,
      type: t.description,
      is_salary_type: salary,
      ledger_group: t.ledger_group || (salary ? 'SALARY' : 'OTHER'),
      side,
      // Μισθός ποτέ αυτόματα σε τιμολόγιο — μόνο ρητό checkbox
      post_to_invoice: false,
    }))
  }

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
          .select(
            'id, description, ledger_group, is_for_sum, sort_order, is_active, ept_type_pay, col_index'
          )
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true })

        if (cancelled) return
        if (err) throw err

        const list = data || []
        setTypes(list)
        const lookup = buildTypeLookup(list)

        let match = null
        if (presetTypeId != null) {
          match = list.find((t) => Number(t.id) === Number(presetTypeId))
        } else if (selectedRowData) {
          match = resolveTransactionTypeFromLedgerRow(lookup, selectedRowData)
        }

        const chosen = match || list[0] || null
        setSelectedTypeId(chosen?.id ?? null)

        if (chosen) {
          const base = selectedRowData
            ? movementFormFromRow(selectedRowData)
            : movementFormFromRow(null)
          const { bucket } = selectedRowData
            ? extractLedgerAmount(selectedRowData)
            : { bucket: null }
          const side =
            presetSide ||
            base.side ||
            (bucket ? sideFromLedgerBucket(bucket) : null) ||
            resolveLedgerSide(chosen, Number(base.amount) || 0, {})
          const salary = typeIsSalary(chosen)
          // Τιμολόγιο μόνο αν η αποθηκευμένη γραμμή είναι ήδη σε invoice_amount
          const postToInvoice =
            bucket === 'invoice_amount' || base.post_to_invoice === true
          setForm({
            ...base,
            type: chosen.description,
            description:
              !selectedRowData && presetDescription
                ? presetDescription
                : isBareEuroText(base.description)
                  ? ''
                  : base.description,
            amount:
              !selectedRowData && presetAmount != null && presetAmount !== ''
                ? String(presetAmount)
                : base.amount,
            is_salary_type: salary,
            ledger_group:
              chosen.ledger_group || (salary ? 'SALARY' : 'OTHER'),
            side,
            post_to_invoice: Boolean(postToInvoice),
          })
        } else if (selectedRowData) {
          setForm(movementFormFromRow(selectedRowData))
        }
      } catch (err) {
        if (!cancelled) {
          setTypes([])
          setTypesError(
            formatSupabaseError(err, { table: 'transaction_types', clientLabel: 'DIAS ERP' }) ||
              err.message ||
              'Λείπει ledger_group — τρέξε supabase/07_transaction_types_ledger_group.sql'
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
  }, [open, selectedRowData, presetTypeId, presetSide, presetDescription, presetAmount, hasInvoice])

  const selectedType = useMemo(
    () => types.find((t) => Number(t.id) === Number(selectedTypeId)) || null,
    [types, selectedTypeId]
  )

  const targetColumn = useMemo(() => {
    if (!selectedType) return null
    if (form.post_to_invoice) return 'invoice_amount'
    return resolveLedgerColumn(selectedType, Number(form.amount) || 0, {
      forceInvoice: false,
      side: form.side,
    })
  }, [selectedType, form.side, form.amount, form.post_to_invoice])

  if (!open) return null

  const patch = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const handleTypeChange = (typeId) => {
    const id = Number(typeId)
    setSelectedTypeId(id)
    const t = types.find((x) => Number(x.id) === id)
    if (!t) return
    applyType(t, isEdit ? form.side : resolveLedgerSide(t, 0, {}))
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

    const isSalary = typeIsSalary(selectedType)
    const side = form.side || 'DEBIT'
    const postAsPayment = shouldPostAsPayment(side)
    const postToInvoice = Boolean(hasInvoice && form.post_to_invoice)
    const invoiceAmount = postToInvoice ? amount : 0
    const rawDescription = form.description?.trim() || ''
    const description =
      rawDescription && !isBareEuroText(rawDescription) ? rawDescription : null
    const notes = form.notes?.trim() || null

    setSaving(true)
    try {
      if (isEdit) {
        if (rowSource === 'PAYMENT') {
          const paymentType = paymentTypeCodeFromDescription(
            selectedType.description,
            selectedType.ledger_group
          )
          const { error } = await diasClient
            .from('payment_entries')
            .update({
              payment_date: form.entry_date,
              payment_type: paymentType,
              amount,
              invoice_amount: invoiceAmount,
              notes,
              entry_date: form.entry_date,
              entry_type: paymentType,
              description,
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
              description,
              notes,
              amount,
              invoice_amount: invoiceAmount,
              is_salary_type: isSalary,
            })
            .eq('id', selectedRowData.id)
          if (error) throw error
        }
      } else if (postAsPayment) {
        const paymentType = paymentTypeCodeFromDescription(
          selectedType.description,
          selectedType.ledger_group
        )
        const { error } = await diasClient.from('payment_entries').insert({
          tech_id: String(tech.id),
          tech_name: tech.displayName || tech.name || null,
          payment_date: form.entry_date,
          payment_type: paymentType,
          amount,
          invoice_amount: invoiceAmount,
          notes,
          entry_date: form.entry_date,
          entry_type: paymentType,
          description,
        })
        if (error) throw error
      } else {
        const { error } = await diasClient.from('payroll_entries').insert({
          tech_id: String(tech.id),
          reference_date: form.entry_date,
          type_code: payrollTypeCodeFromDescription(selectedType.description),
          description,
          notes,
          amount,
          invoice_amount: invoiceAmount,
          is_salary_type: isSalary,
        })
        if (error) throw error
      }

      onSaved?.({
        wasPayment: isEdit ? rowSource === 'PAYMENT' : postAsPayment,
      })
      onClose?.()
    } catch (err) {
      const table =
        isEdit
          ? rowSource === 'PAYMENT'
            ? 'payment_entries'
            : 'payroll_entries'
          : postAsPayment
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

  const displayError = saveError || externalError
  const formDisabled = typesLoading || types.length === 0 || saving

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[1px]"
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
            <h3 className="text-lg font-bold text-white">
              {isEdit ? 'Επεξεργασία Κίνησης' : 'Κίνηση'}
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {typesLoading
                ? 'Φόρτωση τύπων από transaction_types...'
                : isEdit
                  ? `Επεξεργασία · ${rowSource === 'PAYMENT' ? 'Πίστωση' : 'Χρέωση'} · ${selectedRowData?.entry_date ? new Date(selectedRowData.entry_date).toLocaleDateString('el-GR') : ''}`
                  : shouldPostAsPayment(form.side)
                    ? 'Νέα πίστωση → payment_entries'
                    : 'Νέα χρέωση → payroll_entries'}
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
                        {t.description} · {ledgerGroupLabel(t.ledger_group)}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Στήλη (ledger_group)
                </label>
                <div
                  className={`mt-1 rounded-xl border px-3 py-2 text-sm font-semibold ${
                    selectedType && typeIsSalary(selectedType)
                      ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100'
                      : 'border-violet-500/30 bg-violet-500/10 text-violet-100'
                  }`}
                >
                  {selectedType ? ledgerGroupLabel(selectedType.ledger_group) : '—'}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Χρέωση / Πίστωση
                </label>
                <select
                  value={form.side || 'DEBIT'}
                  onChange={(e) => patch('side', e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                >
                  <option value="DEBIT">Χρέωση (Δεδουλευμένα)</option>
                  <option value="CREDIT">Πίστωση (Πληρωμή)</option>
                </select>
              </div>
            </div>

            {hasInvoice === true && (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                <input
                  type="checkbox"
                  checked={Boolean(form.post_to_invoice)}
                  onChange={(e) => patch('post_to_invoice', e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-slate-950 text-amber-500 focus:ring-amber-500/40"
                />
                Στήλη Τιμολόγιο Χρ.-Πιστ.
              </label>
            )}

            {targetColumn && (
              <p className="rounded-lg border border-white/5 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-400">
                Στόχος στο grid:{' '}
                <span className="font-semibold text-slate-200">{ledgerColumnLabel(targetColumn)}</span>
              </p>
            )}

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
                type="text"
                inputMode="decimal"
                autoComplete="off"
                required
                value={toElInputDisplay(form.amount)}
                onChange={(e) => patch('amount', fromElInputValue(e.target.value))}
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white"
              />
            </div>

            {selectedType && !typesLoading && (
              <p className="text-[11px] text-slate-500">
                id={selectedType.id} · {ledgerGroupLabel(selectedType.ledger_group)} · is_for_sum=
                {String(selectedType.is_for_sum)}
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
