import React, { useEffect, useMemo, useState } from 'react'
import { diasClient, fetchAllRows, formatSupabaseError } from '../lib/supabase'
import { computeLedgerBalances } from '../lib/techLedger'
import { isTemporaryPersonnel, personnelIssuesInvoice } from '../lib/personnel'
import { formatEuro } from '../lib/payrollAnalysis'
import { greekCapsLabel } from '../lib/greekDate'
import { useDraggableModal, MODAL_POS_KEYS } from '../lib/useDraggableModal'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function personDisplayName(p) {
  return (
    String(p?.tech_name || '').trim() ||
    [p?.last_name, p?.first_name].filter(Boolean).join(' ').trim() ||
    String(p?.tech_id || p?.id || '—')
  )
}

function personTechKeys(p) {
  const keys = new Set()
  if (p?.tech_id != null && p.tech_id !== '') keys.add(String(p.tech_id))
  if (p?.id != null && p.id !== '') keys.add(String(p.id))
  return keys
}

/** All-time οφειλές ενεργών έκτακτων — ίδια λογική με το modal. */
export async function fetchTemporaryPayablesSummary(personnel = []) {
  const temps = (personnel || []).filter(
    (p) => isTemporaryPersonnel(p) && p.is_active !== false
  )
  if (temps.length === 0) {
    return { rows: [], totalInvoice: 0, totalCash: 0 }
  }

  const idSet = new Set()
  for (const p of temps) {
    for (const k of personTechKeys(p)) idSet.add(k)
  }
  const idList = [...idSet]
  const ledgerRows = await fetchAllRows(diasClient, 'tech_ledger_view', (q) =>
    q.in('tech_id', idList)
  )

  const byTech = new Map()
  for (const row of ledgerRows || []) {
    const techId = String(row.tech_id ?? '')
    if (!techId || !idSet.has(techId)) continue
    let list = byTech.get(techId)
    if (!list) {
      list = []
      byTech.set(techId, list)
    }
    list.push(row)
  }

  const rows = temps.map((person) => {
    const keys = personTechKeys(person)
    const personRows = []
    for (const k of keys) {
      const list = byTech.get(k)
      if (list) personRows.push(...list)
    }
    const balances = computeLedgerBalances(personRows)
    const invoice = personnelIssuesInvoice(person)
    const amount = round2(invoice ? balances.invoice : balances.balance2)
    return {
      person,
      name: personDisplayName(person),
      paymentLabel: invoice ? 'Τιμολόγιο' : 'Μετρητά',
      invoice,
      amount,
    }
  })

  rows.sort((a, b) => {
    const aOpen = a.amount > 0.005 ? 1 : 0
    const bOpen = b.amount > 0.005 ? 1 : 0
    if (aOpen !== bOpen) return bOpen - aOpen
    if (a.amount !== b.amount) return b.amount - a.amount
    return String(a.name).localeCompare(String(b.name), 'el')
  })

  let totalInvoice = 0
  let totalCash = 0
  for (const r of rows) {
    if (r.amount <= 0.005) continue
    if (r.invoice) totalInvoice += r.amount
    else totalCash += r.amount
  }

  return {
    rows,
    totalInvoice: round2(totalInvoice),
    totalCash: round2(totalCash),
  }
}

/**
 * Aging report οφειλών έκτακτων — all-time υπόλοιπο (ΤΙΜ ή Λοιπά).
 * Δεν αλλάζει computeLedgerBalances · μόνο μεγαλύτερο dataset.
 */
export default function TemporaryPayablesModal({
  open,
  personnel = [],
  onClose,
  onSelectPerson,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [rows, setRows] = useState([])
  const { panelStyle, dragHandleProps, dragHandleClassName } = useDraggableModal(
    open,
    MODAL_POS_KEYS.temporaryPayables
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const summary = await fetchTemporaryPayablesSummary(personnel)
        if (!cancelled) setRows(summary.rows)
      } catch (err) {
        if (!cancelled) {
          setRows([])
          setError(
            formatSupabaseError(err, { table: 'tech_ledger_view', clientLabel: 'DIAS ERP' }) ||
              err?.message ||
              'Αποτυχία φόρτωσης οφειλών'
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [open, personnel])

  const { totalInvoice, totalCash, totalOwed } = useMemo(() => {
    let invoice = 0
    let cash = 0
    for (const r of rows) {
      if (r.amount <= 0.005) continue
      if (r.invoice) invoice += r.amount
      else cash += r.amount
    }
    invoice = round2(invoice)
    cash = round2(cash)
    return {
      totalInvoice: invoice,
      totalCash: cash,
      totalOwed: round2(invoice + cash),
    }
  }, [rows])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-none"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <div
        className="relative flex max-h-[min(85vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
        style={panelStyle}
      >
        <div
          className={`flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-5 py-4 ${dragHandleClassName}`}
          {...dragHandleProps}
        >
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-amber-400/80">
              {greekCapsLabel('Έκτακτοι')}
            </p>
            <h3 className="text-lg font-bold text-white">Διαχείριση Οφειλών</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Συνολικό ανοιχτό υπόλοιπο (all-time) · ΤΙΜ ή Λοιπά ανά τρόπο πληρωμής
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Υπολογισμός οφειλών...</p>
          ) : error ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              Δεν υπάρχουν ενεργοί έκτακτοι υπάλληλοι.
            </p>
          ) : (
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-2 font-semibold">Όνομα</th>
                  <th className="px-2 py-2 font-semibold">Τρόπος</th>
                  <th className="px-2 py-2 text-right font-semibold">Υπόλοιπο</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.person.id || row.person.tech_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      onSelectPerson?.(row.person)
                      onClose?.()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectPerson?.(row.person)
                        onClose?.()
                      }
                    }}
                    className={`cursor-pointer border-b border-white/5 transition hover:bg-cyan-500/10 ${
                      row.amount > 0.005 ? 'text-slate-100' : 'text-slate-500'
                    }`}
                    title="Άνοιγμα καρτέλας για εξόφληση"
                  >
                    <td className="px-2 py-2.5 font-semibold">{row.name}</td>
                    <td className="px-2 py-2.5">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          row.invoice
                            ? 'border-amber-500/40 bg-amber-500/15 text-amber-100'
                            : 'border-slate-500/40 bg-slate-500/15 text-slate-200'
                        }`}
                      >
                        {row.paymentLabel}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                      {formatEuro(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/15 bg-slate-950/50">
                  <td colSpan={2} className="px-2 py-2.5 text-xs font-semibold uppercase tracking-wide text-amber-200/80">
                    Σύνολο τιμολογίων
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-sm font-bold tabular-nums text-amber-100">
                    {formatEuro(totalInvoice)}
                  </td>
                </tr>
                <tr className="bg-slate-950/50">
                  <td colSpan={2} className="px-2 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Σύνολο μετρητών
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-sm font-bold tabular-nums text-slate-100">
                    {formatEuro(totalCash)}
                  </td>
                </tr>
                <tr className="border-t border-white/10 bg-slate-950/70">
                  <td colSpan={2} className="px-2 py-3 text-xs font-semibold uppercase tracking-wide text-cyan-300/80">
                    Γενικό σύνολο
                  </td>
                  <td className="px-2 py-3 text-right font-mono text-sm font-bold tabular-nums text-cyan-100">
                    {formatEuro(totalOwed)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-white/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
          >
            Κλείσιμο
          </button>
        </div>
      </div>
    </div>
  )
}
