import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  formatLedgerAmount,
  formatLedgerImportAt,
  isTicketRestaurantRow,
  ledgerDescriptionForRow,
  ledgerTypeLabel,
} from '../lib/techLedger'
import { ledgerRowClassName } from '../lib/ledgerMapping'
import { resolveTransactionTypeFromLedgerRow } from '../lib/transactionTypes'
import { formatEuro } from '../lib/payrollAnalysis'
import { isLoanInstallmentRow } from '../lib/loanUi'

function renderCreditAmount(row, value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  if (isLoanInstallmentRow(row)) {
    return (
      <span className="font-medium text-red-400">
        - {formatEuro(n)}
      </span>
    )
  }
  return formatLedgerAmount(value)
}

const COLUMN_WIDTHS_STORAGE_KEY = 'dias_ledger_column_widths_v5'

const INVOICE_COLUMNS = [
  {
    id: 'invoice_amount',
    label: 'Τιμολόγιο Χρ.',
    defaultWidth: 96,
    minWidth: 52,
    align: 'right',
    group: 'invoice',
  },
  {
    id: 'invoice_credit',
    label: 'Τιμολόγιο Πιστ.',
    defaultWidth: 96,
    minWidth: 52,
    align: 'right',
    group: 'invoice',
  },
]

/** Base columns; invoice debit+credit inserted after other_credit when hasInvoice. */
const BASE_COLUMN_DEFS = [
  { id: 'entry_date', label: 'Ημερομηνία', defaultWidth: 92, minWidth: 64 },
  { id: 'type', label: 'Τύπος', defaultWidth: 120, minWidth: 56 },
  { id: 'description', label: 'Περιγραφή', defaultWidth: 220, minWidth: 72 },
  {
    id: 'salary_debit',
    label: 'Μισθός Χρ.',
    defaultWidth: 88,
    minWidth: 44,
    align: 'right',
    group: 'salary',
  },
  {
    id: 'salary_credit',
    label: 'Μισθός Πιστ.',
    defaultWidth: 88,
    minWidth: 44,
    align: 'right',
    group: 'salary',
  },
  {
    id: 'other_debit',
    label: 'Λοιπά Χρ.',
    defaultWidth: 88,
    minWidth: 44,
    align: 'right',
    group: 'other',
  },
  {
    id: 'other_credit',
    label: 'Λοιπά Πιστ.',
    defaultWidth: 88,
    minWidth: 44,
    align: 'right',
    group: 'other',
  },
  { id: 'notes', label: 'Σημειώσεις', defaultWidth: 140, minWidth: 56 },
  {
    id: 'imported_at',
    label: 'Εισαγωγή',
    defaultWidth: 118,
    minWidth: 72,
    align: 'center',
  },
]

function getColumnDefs(hasInvoice) {
  if (!hasInvoice) return BASE_COLUMN_DEFS
  const defs = []
  for (const col of BASE_COLUMN_DEFS) {
    defs.push(col)
    if (col.id === 'other_credit') defs.push(...INVOICE_COLUMNS)
  }
  return defs
}

function defaultColumnWidths(hasInvoice) {
  return Object.fromEntries(getColumnDefs(hasInvoice).map((c) => [c.id, c.defaultWidth]))
}

function loadColumnWidths(hasInvoice) {
  const defaults = defaultColumnWidths(hasInvoice)
  try {
    const raw = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults

    const merged = { ...defaults }
    for (const col of getColumnDefs(true)) {
      const w = Number(parsed[col.id])
      if (Number.isFinite(w) && w >= (col.minWidth ?? 28)) {
        merged[col.id] = w
      }
    }
    return merged
  } catch {
    return defaults
  }
}

function persistColumnWidths(widths) {
  try {
    localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // quota / private mode — ignore
  }
}

function widthFor(columnWidths, colId, hasInvoice) {
  const col = getColumnDefs(hasInvoice).find((c) => c.id === colId)
  return columnWidths[colId] ?? col?.defaultWidth ?? 80
}

function activeBucket(row) {
  const cols = [
    ['salary_debit', Number(row.salary_debit) || 0],
    ['salary_credit', Number(row.salary_credit) || 0],
    ['other_debit', Number(row.other_debit) || 0],
    ['other_credit', Number(row.other_credit) || 0],
    ['invoice_amount', Number(row.invoice_amount) || 0],
    ['invoice_credit', Number(row.invoice_credit) || 0],
  ]
  const hit = cols.find(([, v]) => v !== 0)
  return hit ? hit[0] : null
}

function formatEntryDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('el-GR')
}

function openRowMovement(row, { onOpenCreateForType, onOpenEditRow }) {
  if (row.__template && row.__type) {
    onOpenCreateForType?.({ typeId: row.__type.id })
    return
  }
  if (!row.__template) {
    onOpenEditRow?.(row)
  }
}

export default function LedgerAnalysisGrid({
  rows = [],
  loading = false,
  skeletonCount = 12,
  selectedRowKey = null,
  typeLookup,
  monthContext = null,
  hasInvoice = false,
  showSalaryBalance = true,
  showOtherBalance = true,
  footerBalances = null,
  invoiceGuideData = null,
  onSelectRow,
  onOpenCreateForType,
  onOpenEditRow,
}) {
  // Strict: false/null/undefined → χωρίς στήλη τιμολογίου (header + cells μαζί)
  const showInvoice = hasInvoice === true || monthContext?.hasInvoice === true
  const columnDefs = useMemo(() => getColumnDefs(showInvoice), [showInvoice])
  /** Ticket Restaurant μόνο στη Μήτρα — όχι στον πίνακα κινήσεων μήνα. */
  const visibleRows = useMemo(
    () => (rows || []).filter((row) => !isTicketRestaurantRow(row)),
    [rows]
  )
  const [columnWidths, setColumnWidths] = useState(() => loadColumnWidths(showInvoice))
  const scrollRef = useRef(null)
  const resizeRef = useRef(null)

  useEffect(() => {
    setColumnWidths((prev) => {
      const defaults = loadColumnWidths(showInvoice)
      return { ...defaults, ...prev }
    })
  }, [showInvoice])

  const descriptionContext = useMemo(
    () => ({
      summary: monthContext?.summary || null,
      earningsForm: monthContext?.earningsForm || null,
      hasInvoice: showInvoice,
    }),
    [monthContext, showInvoice]
  )

  const setAndPersistWidths = useCallback((updater) => {
    setColumnWidths((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      persistColumnWidths(next)
      return next
    })
  }, [])

  const resolvedWidths = useMemo(() => {
    const resolved = {}
    for (const col of columnDefs) {
      resolved[col.id] = widthFor(columnWidths, col.id, showInvoice)
    }
    return resolved
  }, [columnWidths, columnDefs, showInvoice])

  const tableWidth = useMemo(
    () => columnDefs.reduce((sum, col) => sum + resolvedWidths[col.id], 0),
    [resolvedWidths, columnDefs]
  )

  const startResize = useCallback(
    (columnId, event) => {
      event.preventDefault()
      event.stopPropagation()
      const def = columnDefs.find((c) => c.id === columnId)
      resizeRef.current = {
        columnId,
        startX: event.clientX,
        startWidth: widthFor(columnWidths, columnId, showInvoice),
        minWidth: def?.minWidth ?? 28,
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [columnWidths, columnDefs, showInvoice]
  )

  useEffect(() => {
    const onMove = (e) => {
      const r = resizeRef.current
      if (!r) return
      const next = Math.max(r.minWidth, r.startWidth + (e.clientX - r.startX))
      setAndPersistWidths((prev) => ({ ...prev, [r.columnId]: next }))
    }
    const onUp = () => {
      if (resizeRef.current) {
        resizeRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setAndPersistWidths])

  const headerClass = (col) => {
    const base =
      'relative border-r border-white/10 select-none px-1.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 last:border-r-0'
    if (col.group === 'salary') return `${base} bg-cyan-500/10 text-cyan-300/90`
    if (col.group === 'other') return `${base} bg-violet-500/10 text-violet-300/90`
    if (col.group === 'invoice') return `${base} bg-amber-500/10 text-amber-200/90`
    if (col.id === 'imported_at') return `${base} bg-slate-950/80 text-slate-300`
    return `${base} bg-slate-950/60`
  }

  const amountCellClass = (colId, bucket, row) => {
    const active = bucket === colId
    const parts = [
      'box-border border-r border-white/10 px-1.5 py-1.5 overflow-hidden text-right font-mono text-xs',
    ]
    if (colId.includes('salary')) parts.push('bg-cyan-500/[0.07]')
    if (colId.includes('other')) parts.push('bg-violet-500/[0.07]')
    if (colId.includes('invoice')) parts.push('bg-amber-500/[0.08] text-amber-100')
    else if (colId.includes('credit')) parts.push('text-emerald-100')
    else parts.push('text-slate-200')
    if (active) parts.push('font-semibold ring-1 ring-inset ring-amber-400/50')
    if (row.__template) parts.push('opacity-70')
    return parts.join(' ')
  }

  const cellStyle = (colId) => ({
    width: resolvedWidths[colId],
    maxWidth: resolvedWidths[colId],
    minWidth: resolvedWidths[colId],
  })

  const renderRow = (row) => {
    const rowKey = row._gridKey
    const isSelected = rowKey && selectedRowKey === rowKey
    const bucket = activeBucket(row)
    const rowType = row.__type || resolveTransactionTypeFromLedgerRow(typeLookup, row)
    const typeLabel = row.__type?.description || rowType?.description || ledgerTypeLabel(row.type)
    const showType = row.__showTypeLabel !== false
    const isTemplate = Boolean(row.__template)
    const dateLabel = !isTemplate ? formatEntryDate(row.entry_date) : ''
    const descriptionLabel = ledgerDescriptionForRow(row, descriptionContext)
    const notesLabel = !isTemplate ? String(row.notes || '').trim() : ''
    const importLabel = !isTemplate ? formatLedgerImportAt(row.created_at) : ''

    return (
      <tr
        key={rowKey}
        onClick={() => onSelectRow?.(row)}
        onDoubleClick={() => openRowMovement(row, { onOpenCreateForType, onOpenEditRow })}
        title={
          isTemplate
            ? 'Κλικ για επιλογή · διπλό κλικ για νέα κίνηση'
            : 'Κλικ για επιλογή · διπλό κλικ για επεξεργασία'
        }
        className={ledgerRowClassName(row, isSelected)}
      >
        <td
          style={cellStyle('entry_date')}
          className={`box-border border-r border-white/10 px-2 py-1.5 align-middle text-xs ${
            isTemplate ? 'text-slate-600' : 'text-sky-300'
          }`}
        >
          <span className="block truncate font-mono" title={dateLabel}>
            {dateLabel}
          </span>
        </td>
        <td
          style={cellStyle('type')}
          className={`box-border border-r border-white/10 px-2 py-1.5 align-top ${
            isTemplate ? 'ledger-cell--template' : 'ledger-cell--saved'
          }`}
        >
          {showType ? (
            <div
              className={`truncate text-xs font-semibold leading-tight ${
                isTemplate
                  ? 'text-slate-200'
                  : row.source === 'PAYMENT'
                    ? 'text-emerald-200'
                    : 'text-rose-200'
              }`}
              title={typeLabel}
            >
              {typeLabel}
            </div>
          ) : null}
        </td>
        <td
          style={cellStyle('description')}
          className={`box-border border-r border-white/10 px-2 py-1.5 align-top text-sm ${
            isTemplate ? 'text-slate-500 italic' : 'text-slate-300'
          }`}
        >
          <span className="block truncate" title={descriptionLabel}>
            {descriptionLabel}
          </span>
        </td>
        <td style={cellStyle('salary_debit')} className={amountCellClass('salary_debit', bucket, row)}>
          {formatLedgerAmount(row.salary_debit)}
        </td>
        <td style={cellStyle('salary_credit')} className={amountCellClass('salary_credit', bucket, row)}>
          {renderCreditAmount(row, row.salary_credit)}
        </td>
        <td style={cellStyle('other_debit')} className={amountCellClass('other_debit', bucket, row)}>
          {formatLedgerAmount(row.other_debit)}
        </td>
        <td style={cellStyle('other_credit')} className={amountCellClass('other_credit', bucket, row)}>
          {renderCreditAmount(row, row.other_credit)}
        </td>
        {showInvoice ? (
          <>
            <td
              style={cellStyle('invoice_amount')}
              className={amountCellClass('invoice_amount', bucket, row)}
            >
              {formatLedgerAmount(row.invoice_amount)}
            </td>
            <td
              style={cellStyle('invoice_credit')}
              className={amountCellClass('invoice_credit', bucket, row)}
            >
              {renderCreditAmount(row, row.invoice_credit)}
            </td>
          </>
        ) : null}
        <td
          style={cellStyle('notes')}
          className="box-border border-r border-white/10 px-2 py-1.5 align-top text-xs text-slate-400"
        >
          <span className="block truncate" title={notesLabel}>
            {notesLabel}
          </span>
        </td>
        <td
          style={cellStyle('imported_at')}
          className="box-border border-r border-white/10 px-1.5 py-1.5 text-center align-middle text-[10px] font-mono text-slate-400 last:border-r-0"
        >
          <span className="block truncate" title={importLabel}>
            {importLabel}
          </span>
        </td>
      </tr>
    )
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto">
      <table
        className="border-collapse text-left"
        style={{ tableLayout: 'fixed', width: tableWidth }}
      >
        <colgroup>
          {columnDefs.map((col) => (
            <col key={col.id} style={{ width: resolvedWidths[col.id] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columnDefs.map((col) => (
              <th
                key={col.id}
                style={cellStyle(col.id)}
                className={`${headerClass(col)} ${
                  col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                }`}
              >
                <span className="block truncate pr-1 leading-tight" title={col.label}>
                  {col.label}
                </span>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Αλλαγή πλάτους στήλης ${col.label}`}
                  onMouseDown={(e) => startResize(col.id, e)}
                  className="absolute -right-px top-0 z-20 h-full w-[5px] cursor-col-resize touch-none hover:bg-cyan-400/40 active:bg-cyan-400/60"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && visibleRows.length === 0
            ? Array.from({ length: Math.max(skeletonCount, 6) }, (_, i) => (
                <tr key={`loading-${i}`} className="h-9 border-b border-white/10">
                  {columnDefs.map((col) => (
                    <td key={col.id} style={cellStyle(col.id)} className="border-r border-white/10 px-1.5">
                      &nbsp;
                    </td>
                  ))}
                </tr>
              ))
            : visibleRows.length === 0
              ? (
                <tr>
                  <td
                    colSpan={columnDefs.length}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    Δεν υπάρχουν κινήσεις για τον επιλεγμένο μήνα. Πάτα «Εισαγωγή» για υπολογισμό από
                    Αποδοχές / Συμφωνίες.
                  </td>
                </tr>
              )
              : visibleRows.map(renderRow)}
        </tbody>
        {footerBalances ? (
          <tfoot>
            <tr className="border-t border-white/15 bg-slate-950/70">
              {/* Ημερομηνία + Τύπος + Περιγραφή → γενικό Υπόλοιπο */}
              <td colSpan={3} className="box-border border-r border-white/10 px-2 py-3 align-middle">
                <div className="flex flex-wrap items-center gap-2">
                  <BalanceChip label="Υπόλοιπο" value={footerBalances.balance} tone="cyan" />
                </div>
              </td>
              {/* Μισθός Χρ. + Μισθός Πιστ. — κενό κελί αν κρυφό (κρατάει colspan) */}
              <td colSpan={2} className="box-border border-r border-white/10 px-2 py-3 align-middle">
                {showSalaryBalance ? (
                  <div className="flex justify-center">
                    <BalanceChip label="Υπόλοιπο (Μ)" value={footerBalances.balance1} />
                  </div>
                ) : null}
              </td>
              {/* Λοιπά Χρ. + Λοιπά Πιστ. */}
              <td colSpan={2} className="box-border border-r border-white/10 px-2 py-3 align-middle">
                {showOtherBalance ? (
                  <div className="flex justify-center">
                    <BalanceChip label="Υπόλοιπο (Λ)" value={footerBalances.balance2} />
                  </div>
                ) : null}
              </td>
              {showInvoice ? (
                <td
                  colSpan={2}
                  className="box-border border-r border-white/10 px-2 py-3 align-middle"
                >
                  <div className="flex flex-col items-center gap-3">
                    <BalanceChip
                      label="Υπόλοιπο (ΤΙΜ)"
                      value={footerBalances.invoice}
                      tone="amber"
                      taxMarkup={
                        invoiceGuideData &&
                        Number(invoiceGuideData.netAmount) !== 0 &&
                        !invoiceGuideData.simpleVatOnly
                          ? {
                              netAmount: Number(invoiceGuideData.netAmount) || 0,
                              taxPercent: Number(invoiceGuideData.taxPercent) || 20,
                            }
                          : null
                      }
                    />
                    {invoiceGuideData && Number(invoiceGuideData.netAmount) !== 0 ? (
                      <InvoiceGuideCard
                        netAmount={Number(invoiceGuideData.netAmount) || 0}
                        taxPercent={Number(invoiceGuideData.taxPercent) || 20}
                        simpleVatOnly={invoiceGuideData.simpleVatOnly === true}
                      />
                    ) : null}
                  </div>
                </td>
              ) : null}
              {/* Σημειώσεις + Εισαγωγή — κενό (χωρίς chip παρακράτησης) */}
              <td colSpan={2} className="box-border px-2 py-3 align-middle last:border-r-0" />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  )
}

function BalanceChip({ label, value, tone = 'slate', taxMarkup = null }) {
  const tones = {
    slate: 'border-white/10 bg-slate-900/80 text-slate-100',
    cyan: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-50',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-50',
  }

  const pct = Number(taxMarkup?.taxPercent) || 20
  const net = Number(taxMarkup?.netAmount) || 0
  const factor = 1 - pct / 100
  const grossed = taxMarkup && factor > 0 ? net / factor : null
  const factorLabel =
    factor > 0
      ? factor.toLocaleString('el-GR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
      : null

  return (
    <div
      className={`min-w-[7.5rem] rounded-xl border px-3 py-2 shadow-sm shadow-black/20 ${tones[tone] || tones.slate}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-bold tabular-nums tracking-tight">{value}</p>
      {grossed != null && factorLabel ? (
        <div className="mt-1.5 border-t border-amber-500/20 pt-1.5 text-center">
          <p className="text-[9px] font-medium leading-tight text-amber-200/55">
            Προσαύξηση φόρου {pct}%
          </p>
          <p className="mt-0.5 text-[9px] tabular-nums text-amber-200/45">/ {factorLabel}</p>
          <p className="mt-0.5 font-mono text-sm font-bold tabular-nums tracking-tight text-amber-50">
            {formatEuro(grossed)}
          </p>
        </div>
      ) : null}
    </div>
  )
}

/** Τοπικό σκονάκι έκδοσης τιμολογίου — δεν αγγίζει computeLedgerBalances. */
function InvoiceGuideCard({ netAmount, taxPercent, simpleVatOnly = false }) {
  const net = Number(netAmount) || 0

  if (simpleVatOnly) {
    const vat = net * 0.24
    const payable = net + vat
    return (
      <div className="w-full max-w-xs rounded-xl border border-slate-700/50 bg-slate-800/60 p-3 text-xs shadow-sm shadow-black/20">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Οδηγός τιμολογίου
        </p>
        <div className="flex justify-between gap-3 py-1 text-slate-300">
          <span>Αξία Τιμολογίου</span>
          <span className="font-mono tabular-nums">{formatEuro(net)}</span>
        </div>
        <div className="flex justify-between gap-3 py-1 text-slate-300">
          <span>ΦΠΑ 24%</span>
          <span className="font-mono tabular-nums">+ {formatEuro(vat)}</span>
        </div>
        <hr className="my-1 border-slate-600" />
        <div className="flex justify-between gap-3 py-1 font-bold text-slate-100">
          <span>Πληρωτέο</span>
          <span className="font-mono tabular-nums">{formatEuro(payable)}</span>
        </div>
      </div>
    )
  }

  const pct = Number(taxPercent) || 20
  const factor = 1 - pct / 100
  const gross = factor > 0 ? net / factor : net
  const vat = gross * 0.24
  const tax = gross * (pct / 100)
  const payable = gross + vat - tax

  return (
    <div className="w-full max-w-xs rounded-xl border border-slate-700/50 bg-slate-800/60 p-3 text-xs shadow-sm shadow-black/20">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Οδηγός τιμολογίου
      </p>
      <div className="flex justify-between gap-3 py-1 text-slate-300">
        <span>Αξία Τιμολογίου</span>
        <span className="font-mono tabular-nums">{formatEuro(gross)}</span>
      </div>
      <div className="flex justify-between gap-3 py-1 text-slate-300">
        <span>ΦΠΑ 24%</span>
        <span className="font-mono tabular-nums">+ {formatEuro(vat)}</span>
      </div>
      <div className="flex justify-between gap-3 py-1 text-slate-300">
        <span>Παρακρ. Φόρου ({pct}%)</span>
        <span className="font-mono tabular-nums">− {formatEuro(tax)}</span>
      </div>
      <hr className="my-1 border-slate-600" />
      <div className="flex justify-between gap-3 py-1 font-bold text-slate-100">
        <span>Πληρωτέο</span>
        <span className="font-mono tabular-nums">{formatEuro(payable)}</span>
      </div>
    </div>
  )
}
