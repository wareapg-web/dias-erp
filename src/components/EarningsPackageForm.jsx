/**
 * Επαναχρησιμοποιήσιμη φόρμα πακέτου αποδοχών.
 * editMode: 'full' | 'toggles-only' | 'none'
 */
import React from 'react'
import {
  EARNINGS_AMOUNT_ONLY_DEFS,
  amountOnlyField,
  autoTransferKeyForRow,
  earningsRateRowDefs,
  earningsRowHasAutoTransfer,
  earningsTransferRowDefs,
  isFixedExpense,
} from '../lib/techEarnings'
import { fromElInputValue, toElInputDisplay } from '../lib/numberFormat'
import { greekCapsLabel } from '../lib/greekDate'

export default function EarningsPackageForm({
  form,
  onPatchField,
  onPatchAutoTransfer,
  onPatchFixedExpense,
  editMode = 'full',
  issuesInvoice = false,
  disabled = false,
  showMetaPanels = true,
  tech = null,
  footerNote = null,
}) {
  const moneyLocked = editMode !== 'full'
  const togglesLocked = editMode === 'none'
  const fieldsDisabled = disabled || moneyLocked
  const checksDisabled = disabled || togglesLocked

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400">
                <th
                  className="w-14 px-2 py-2.5 text-center font-semibold"
                  title="Σταθερό/στάνταρ μηνιαίο έξοδο (τικ) · μεταβλητό (κενό)"
                >
                  {greekCapsLabel('Σταθερό')}
                </th>
                <th className="px-4 py-2.5 font-semibold">{greekCapsLabel('Τύπος')}</th>
                <th
                  className="w-16 px-1 py-2.5 text-center font-semibold text-cyan-400/90"
                  title="Συμπερίληψη στη Δημιουργία μήνα"
                >
                  {greekCapsLabel('Δημιουργία')}
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">{greekCapsLabel('Ποσό')}</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  {greekCapsLabel('> από')}
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  {greekCapsLabel('Ελάχιστο')}
                </th>
              </tr>
            </thead>
            <tbody>
              {earningsTransferRowDefs().map((def, idx) => {
                const transferKey = autoTransferKeyForRow(def)
                const showTransfer = earningsRowHasAutoTransfer(def)
                const transferOn =
                  showTransfer && form.auto_transfer_settings?.[transferKey] === true
                const fixedOn = isFixedExpense(form, def.key)
                return (
                  <tr
                    key={def.key}
                    className={`border-b border-white/5 ${idx % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                  >
                    <td className="px-2 py-1.5 text-center">
                      <ToggleCheck
                        checked={fixedOn}
                        disabled={checksDisabled}
                        amber
                        title={fixedOn ? 'Σταθερό/στάνταρ μηνιαίο έξοδο' : 'Μεταβλητό έξοδο'}
                        onChange={(checked) => onPatchFixedExpense?.(def.key, checked)}
                      />
                    </td>
                    <td className="px-4 py-1.5 font-medium text-white">{def.label}</td>
                    <td className="px-1 py-1.5 text-center">
                      {showTransfer ? (
                        <ToggleCheck
                          checked={transferOn}
                          disabled={checksDisabled}
                          title="Συμπερίληψη στη Δημιουργία"
                          onChange={(checked) => onPatchAutoTransfer?.(transferKey, checked)}
                        />
                      ) : null}
                    </td>
                    {['amount', 'from', 'min'].map((suffix) => {
                      const field = `${def.key}_${suffix}`
                      return (
                        <td key={field} className="px-2 py-1">
                          <MoneyInput
                            value={form[field] ?? ''}
                            disabled={fieldsDisabled}
                            onChange={(v) => onPatchField?.(field, v)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {EARNINGS_AMOUNT_ONLY_DEFS.filter(
                (def) => !def.invoiceOnly || issuesInvoice
              ).map((def, idx) => {
                const field = amountOnlyField(def)
                const transferKey = autoTransferKeyForRow(def)
                const showTransfer = earningsRowHasAutoTransfer(def)
                const transferOn =
                  showTransfer && form.auto_transfer_settings?.[transferKey] === true
                const fixedOn = isFixedExpense(form, def.key)
                return (
                  <tr
                    key={def.key}
                    className={`border-b border-white/5 ${(earningsTransferRowDefs().length + idx) % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                  >
                    <td className="px-2 py-1.5 text-center">
                      <ToggleCheck
                        checked={fixedOn}
                        disabled={checksDisabled}
                        amber
                        title={fixedOn ? 'Σταθερό/στάνταρ μηνιαίο έξοδο' : 'Μεταβλητό έξοδο'}
                        onChange={(checked) => onPatchFixedExpense?.(def.key, checked)}
                      />
                    </td>
                    <td className="px-4 py-1.5 font-medium text-white">{def.label}</td>
                    <td className="px-1 py-1.5 text-center">
                      {showTransfer ? (
                        <ToggleCheck
                          checked={transferOn}
                          disabled={checksDisabled}
                          title="Συμπερίληψη στη Δημιουργία"
                          onChange={(checked) => onPatchAutoTransfer?.(transferKey, checked)}
                        />
                      ) : null}
                    </td>
                    <td className="px-2 py-1">
                      <MoneyInput
                        value={form[field] ?? ''}
                        disabled={fieldsDisabled}
                        onChange={(v) => onPatchField?.(field, v)}
                      />
                    </td>
                    <td className="px-2 py-1" />
                    <td className="px-2 py-1" />
                  </tr>
                )
              })}
              {earningsRateRowDefs().map((def, idx) => {
                const baseIdx =
                  earningsTransferRowDefs().length +
                  EARNINGS_AMOUNT_ONLY_DEFS.filter((d) => !d.invoiceOnly || issuesInvoice)
                    .length +
                  idx
                const fixedOn = isFixedExpense(form, def.key)
                return (
                  <tr
                    key={def.key}
                    className={`border-b border-white/5 ${baseIdx % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                  >
                    <td className="px-2 py-1.5 text-center">
                      <ToggleCheck
                        checked={fixedOn}
                        disabled={checksDisabled}
                        amber
                        title={fixedOn ? 'Σταθερό/στάνταρ μηνιαίο έξοδο' : 'Μεταβλητό έξοδο'}
                        onChange={(checked) => onPatchFixedExpense?.(def.key, checked)}
                      />
                    </td>
                    <td className="px-4 py-1.5 font-medium text-white">{def.label}</td>
                    <td className="px-1 py-1.5" />
                    {['amount', 'from', 'min'].map((suffix) => {
                      const field = `${def.key}_${suffix}`
                      return (
                        <td key={field} className="px-2 py-1">
                          <MoneyInput
                            value={form[field] ?? ''}
                            disabled={fieldsDisabled}
                            onChange={(v) => onPatchField?.(field, v)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {footerNote ? (
          <p className="border-t border-white/5 px-4 py-2 text-[11px] text-slate-500">{footerNote}</p>
        ) : null}
      </div>

      {showMetaPanels ? (
        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-72">
          <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 shadow-xl backdrop-blur-md">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
              {greekCapsLabel('Στοιχεία')}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
                  {greekCapsLabel('Αρ. Λογαριασμού')}
                </label>
                <input
                  type="text"
                  value={tech?.iban || ''}
                  readOnly
                  disabled
                  placeholder="από καρτέλα υπαλλήλου"
                  className="mt-1 w-full cursor-not-allowed rounded-xl border border-white/15 bg-slate-950/40 px-3 py-2 font-mono text-sm font-semibold text-slate-100"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
                  {greekCapsLabel('Τράπεζα')}
                </label>
                <input
                  type="text"
                  value={tech?.bank_name || ''}
                  readOnly
                  disabled
                  placeholder="από καρτέλα υπαλλήλου"
                  className="mt-1 w-full cursor-not-allowed rounded-xl border border-white/15 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-100"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 shadow-xl backdrop-blur-md">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
              {greekCapsLabel('Παραστατικό')}
            </p>
            <p
              className={
                issuesInvoice
                  ? 'text-sm font-bold text-cyan-100'
                  : 'text-sm font-bold text-slate-300'
              }
            >
              {issuesInvoice ? 'Με τιμολόγιο' : 'Χωρίς τιμολόγιο'}
            </p>
            {issuesInvoice ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-2">
                  <label className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-slate-200">
                    {greekCapsLabel('Παρακράτηση Φόρου (%)')}
                  </label>
                  <input
                    type="text"
                    value={form.extra ?? ''}
                    onChange={(e) => onPatchField?.('extra', e.target.value)}
                    disabled={fieldsDisabled}
                    className="w-full rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 font-mono text-sm font-semibold text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white"
                  />
                </div>
                <label
                  className={`flex items-start gap-2.5 rounded-xl border border-white/15 bg-slate-950/40 px-3 py-2.5 ${
                    fieldsDisabled ? 'cursor-default' : 'cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.invoice_gross_up !== false}
                    onChange={(e) => onPatchField?.('invoice_gross_up', e.target.checked)}
                    disabled={fieldsDisabled}
                    className="mt-0.5 h-4 w-4 rounded border-white/20 bg-slate-900 text-cyan-500 focus:ring-cyan-500/40 disabled:opacity-100"
                  />
                  <span className="text-sm font-semibold leading-snug text-white">
                    Εφαρμογή Προσαύξησης 20%
                    <span className="mt-0.5 block text-[11px] font-medium text-slate-300">
                      Αν απενεργοποιηθεί, η Αξία Τιμολογίου = Υπόλοιπο (ΤΙΜ)
                    </span>
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ToggleCheck({ checked, disabled, onChange, title, amber = false }) {
  return (
    <label
      className={`group relative inline-flex items-center justify-center ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
      title={title}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className={
          amber
            ? 'peer h-3.5 w-3.5 appearance-none rounded border border-amber-400/40 bg-slate-950/80 transition checked:border-amber-400/70 checked:bg-amber-500/80 disabled:opacity-50'
            : 'peer h-3.5 w-3.5 appearance-none rounded border border-white/25 bg-slate-950/80 transition checked:border-cyan-400/60 checked:bg-cyan-500/80 disabled:opacity-50'
        }
      />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-950 opacity-0 peer-checked:opacity-100">
        ✓
      </span>
    </label>
  )
}

function MoneyInput({ value, disabled, onChange }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={toElInputDisplay(value ?? '')}
      onChange={(e) => onChange?.(fromElInputValue(e.target.value))}
      disabled={disabled}
      readOnly={disabled}
      className="w-full min-w-0 rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-right font-mono text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
    />
  )
}
