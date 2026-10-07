import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { diasClient, fetchAllRows, formatSupabaseError } from '../lib/supabase'
import { isTemporaryPersonnel } from '../lib/personnel'
import { buildLedgerYearMatrix } from '../lib/techLedger'
import { earningsFromDb } from '../lib/techEarnings'
import { parseElNumber } from '../lib/numberFormat'
import {
  formatEuro,
  formatMatrixTicket,
  MONTH_LABELS,
} from '../lib/payrollAnalysis'
import { loadPayrollBenefitsByTechForMonth } from '../lib/monthPayrollExport'
import { exportEarningsBoardToExcel } from '../lib/earningsBoardExport'
import { greekCapsLabel } from '../lib/greekDate'
import {
  ROW_DENSITY_META,
  nextRowDensity,
  rowDensityStyles,
} from '../lib/rowDensity'

const DENSITY_KEY = 'dias-erp:earnings-board:density'
const WIDTHS_KEY = 'dias-erp:earnings-board:col-widths'
const ORDER_KEY = 'dias-erp:earnings-board:row-order'
const COL_ORDER_KEY = 'dias-erp:earnings-board:col-order'

const NAME_COL = { id: 'name', defaultWidth: 220, minWidth: 120 }
const METRIC_DEFAULT_WIDTH = 104
const METRIC_MIN_WIDTH = 56

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

function formatCell(value) {
  const n = Number(value) || 0
  if (Math.abs(n) < 0.005) return '-'
  return formatEuro(n)
}

function formatBalance(value) {
  const n = Number(value) || 0
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '-'
  return formatEuro(n)
}

function permanentTargets(personnel = []) {
  return (personnel || [])
    .filter(
      (p) =>
        p &&
        p.is_active !== false &&
        !isTemporaryPersonnel(p) &&
        p.tech_id != null &&
        String(p.tech_id).trim() !== ''
    )
    .slice()
    .sort((a, b) =>
      personDisplayName(a).localeCompare(personDisplayName(b), 'el', {
        sensitivity: 'base',
      })
    )
}

const METRIC_ROWS = [
  {
    key: 'sigma',
    label: 'Σ',
    hint: 'Απολαβές',
    format: (slot) => formatCell(slot?.sigma),
    bold: true,
  },
  {
    key: 'yM',
    label: 'Υ (Μ)',
    hint: 'Υπόλοιπο Μισθού',
    format: (slot) => formatBalance(slot?.yM),
  },
  {
    key: 'yL',
    label: 'Υ (Λ)',
    hint: 'Υπόλοιπο Λοιπών',
    format: (slot) => formatBalance(slot?.yL),
  },
  {
    key: 'yTim',
    label: 'Υ (ΤΙΜ)',
    hint: 'Υπόλοιπο Τιμολογίου',
    format: (slot) => formatBalance(slot?.yTim),
  },
  {
    key: 'ticket',
    label: 'Ticket Restaurant',
    hint: '',
    format: (slot) => formatMatrixTicket(slot?.ticket),
  },
  {
    key: 'insurance',
    label: 'Ασφάλιση',
    hint: '',
    format: (slot) => formatMatrixTicket(slot?.insurance),
  },
  {
    key: 'pi',
    label: 'Π',
    hint: 'Πληρωμές',
    format: (slot) => formatCell(slot?.pi),
    bold: true,
  },
  {
    key: 'salary',
    label: 'Μισθός',
    hint: 'Χρεώσεις',
    format: (slot) => formatCell(slot?.salaryDebit),
    indent: true,
  },
  {
    key: 'other',
    label: 'Λοιπά',
    hint: 'Χρεώσεις',
    format: (slot) => formatCell(slot?.otherDebit),
    indent: true,
  },
  {
    key: 'invoice',
    label: 'Τιμολόγιο',
    hint: 'Χρεώσεις',
    format: (slot) => formatCell(slot?.invoiceDebit),
    indent: true,
  },
]

function loadDensity() {
  try {
    const n = Number(localStorage.getItem(DENSITY_KEY))
    if (n === 0 || n === 1 || n === 2) return n
  } catch {
    /* ignore */
  }
  return 0 // πιο ανοιχτό
}

function saveDensity(level) {
  try {
    localStorage.setItem(DENSITY_KEY, String(level))
  } catch {
    /* ignore */
  }
}

function defaultWidths() {
  const w = { [NAME_COL.id]: NAME_COL.defaultWidth }
  for (const m of METRIC_ROWS) w[m.key] = METRIC_DEFAULT_WIDTH
  return w
}

function loadWidths() {
  const defaults = defaultWidths()
  try {
    const raw = localStorage.getItem(WIDTHS_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults
    const merged = { ...defaults }
    for (const id of Object.keys(defaults)) {
      const n = Number(parsed[id])
      const min = id === NAME_COL.id ? NAME_COL.minWidth : METRIC_MIN_WIDTH
      if (Number.isFinite(n) && n >= min) merged[id] = Math.round(n)
    }
    return merged
  } catch {
    return defaults
  }
}

function saveWidths(widths) {
  try {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths))
  } catch {
    /* ignore */
  }
}

function loadOrder() {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function saveOrder(ids) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids.map(String)))
  } catch {
    /* ignore */
  }
}

function defaultColOrder() {
  return METRIC_ROWS.map((m) => m.key)
}

function loadColOrder() {
  const defaults = defaultColOrder()
  try {
    const raw = localStorage.getItem(COL_ORDER_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaults
    const known = new Set(defaults)
    const ordered = []
    const seen = new Set()
    for (const key of parsed) {
      const k = String(key)
      if (known.has(k) && !seen.has(k)) {
        ordered.push(k)
        seen.add(k)
      }
    }
    for (const k of defaults) {
      if (!seen.has(k)) ordered.push(k)
    }
    return ordered
  } catch {
    return defaults
  }
}

function saveColOrder(keys) {
  try {
    localStorage.setItem(COL_ORDER_KEY, JSON.stringify(keys.map(String)))
  } catch {
    /* ignore */
  }
}

/** Εφαρμογή αποθηκευμένης σειράς · νέοι υπάλληλοι στο τέλος (αλφαβητικά). */
function applySavedOrder(list, savedIds) {
  if (!list?.length) return []
  const byId = new Map(list.map((r) => [String(r.techId), r]))
  const ordered = []
  const seen = new Set()
  for (const id of savedIds || []) {
    const row = byId.get(String(id))
    if (row && !seen.has(String(id))) {
      ordered.push(row)
      seen.add(String(id))
    }
  }
  for (const row of list) {
    const id = String(row.techId)
    if (!seen.has(id)) {
      ordered.push(row)
      seen.add(id)
    }
  }
  return ordered
}

function metricsInOrder(keys) {
  const byKey = new Map(METRIC_ROWS.map((m) => [m.key, m]))
  const ordered = []
  for (const key of keys || []) {
    const m = byKey.get(key)
    if (m) ordered.push(m)
  }
  if (ordered.length < METRIC_ROWS.length) {
    for (const m of METRIC_ROWS) {
      if (!ordered.some((x) => x.key === m.key)) ordered.push(m)
    }
  }
  return ordered
}

function minWidthFor(colId) {
  return colId === NAME_COL.id ? NAME_COL.minWidth : METRIC_MIN_WIDTH
}

/** Session cache — instant reopen του ίδιου μήνα. */
const boardCache = new Map()

function boardCacheKey(year, month, idList) {
  return `${Number(year)}-${Number(month)}|${idList.slice().sort().join(',')}`
}

function personnelIdFingerprint(personnel) {
  return permanentTargets(personnel)
    .map((p) => String(p.tech_id))
    .sort()
    .join(',')
}

/**
 * Μήνας απολαβών για όλους τους ενεργούς μόνιμους — ίδια λογική με την ετήσια μήτρα.
 * Φορτώνει ΜΟΝΟ τον επιλεγμένο μήνα (όχι όλο το έτος) + earnings · χωρίς agreement versions.
 */
export async function fetchEarningsBoardRows({ personnel, year, month }) {
  const targets = permanentTargets(personnel)
  if (!targets.length) return []

  const idSet = new Set()
  for (const p of targets) {
    for (const k of personTechKeys(p)) idSet.add(k)
  }
  const idList = [...idSet]
  const y = Number(year)
  const m = Number(month)
  const cacheKey = boardCacheKey(y, m, idList)
  const cached = boardCache.get(cacheKey)
  if (cached?.rows) return cached.rows

  const [ledgerRows, payrollBenefits, earningsRows] = await Promise.all([
    // select('*') — μην ζητάς στήλες που μπορεί να λείπουν από παλιότερα views
    fetchAllRows(diasClient, 'tech_ledger_view', (q) =>
      q.eq('year', y).eq('month', m).in('tech_id', idList)
    ),
    loadPayrollBenefitsByTechForMonth(m, y),
    fetchAllRows(diasClient, 'tech_earnings', (q) => q.in('tech_id', idList)).catch(
      () => []
    ),
  ])

  const ledgerByTech = new Map()
  for (const row of ledgerRows || []) {
    const techId = String(row.tech_id ?? '')
    if (!techId || !idSet.has(techId)) continue
    let list = ledgerByTech.get(techId)
    if (!list) {
      list = []
      ledgerByTech.set(techId, list)
    }
    list.push(row)
  }

  const earningsByTech = new Map()
  for (const row of earningsRows || []) {
    const techId = String(row.tech_id ?? '')
    if (!techId) continue
    earningsByTech.set(techId, row)
  }

  const rows = targets.map((person) => {
    const keys = personTechKeys(person)
    const primaryId = String(person.tech_id)
    const personLedger = []
    for (const k of keys) {
      const list = ledgerByTech.get(k)
      if (list) personLedger.push(...list)
    }

    let earningsRow = null
    for (const k of keys) {
      if (earningsByTech.has(k)) {
        earningsRow = earningsByTech.get(k)
        break
      }
    }
    const earningsForm = earningsRow ? earningsFromDb(earningsRow) : null

    let ticket = 0
    let insurance = 0
    for (const k of keys) {
      ticket = Math.max(ticket, Number(payrollBenefits.ticketByTech.get(k)) || 0)
      insurance = Math.max(insurance, Number(payrollBenefits.insuranceByTech.get(k)) || 0)
    }

    const yearPayrolls =
      ticket > 0 || insurance > 0
        ? [
            {
              tech_id: primaryId,
              month: m,
              year: y,
              period: `${y}-${String(m).padStart(2, '0')}`,
              ticket_restaurant: ticket,
              ticket_amount: ticket,
              insurance,
              insurance_amount: insurance,
            },
          ]
        : []

    const matrix = buildLedgerYearMatrix(personLedger, y, yearPayrolls, {
      earningsTicketAmount: round2(parseElNumber(earningsForm?.ticket_amount) || 0),
      earningsInsuranceAmount: round2(parseElNumber(earningsForm?.insurance_amount) || 0),
      techIsTemporary: false,
      agreementVersions: [],
      earningsForm,
    })
    const slot = matrix.months[m - 1] || null

    return {
      person,
      techId: primaryId,
      name: personDisplayName(person),
      month: slot,
    }
  })

  boardCache.set(cacheKey, { rows, at: Date.now() })
  return rows
}

/** Καθαρίζει cache (π.χ. μετά οριστική αποθήκευση) · αν omitted → όλα. */
export function invalidateEarningsBoardCache(year, month) {
  if (year == null || month == null) {
    boardCache.clear()
    return
  }
  const prefix = `${Number(year)}-${Number(month)}|`
  for (const key of [...boardCache.keys()]) {
    if (key.startsWith(prefix)) boardCache.delete(key)
  }
}

function BoardDensityToggle({ density, onCycle }) {
  const level = Number(density) === 1 || Number(density) === 2 ? Number(density) : 0
  const meta = ROW_DENSITY_META[level]
  return (
    <button
      type="button"
      onClick={onCycle}
      aria-label={`Πυκνότητα γραμμών: ${meta.label}`}
      title={`${meta.title} — κλικ για αλλαγή`}
      className="inline-flex h-8 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-300 transition hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-cyan-100"
    >
      <span className="flex flex-col justify-center gap-[2px]" aria-hidden>
        <span
          className={`block h-[2px] rounded-full bg-current ${
            level === 0 ? 'w-3.5' : level === 1 ? 'w-3' : 'w-2.5'
          }`}
        />
        <span
          className={`block h-[2px] rounded-full bg-current ${
            level === 0 ? 'w-3.5 opacity-80' : level === 1 ? 'w-3 opacity-90' : 'w-2.5'
          }`}
        />
        <span
          className={`block h-[2px] rounded-full bg-current ${
            level === 0 ? 'w-3.5 opacity-60' : level === 1 ? 'w-3 opacity-70' : 'w-2.5'
          }`}
        />
      </span>
      <span className="min-w-[0.85rem] text-center tabular-nums">{meta.short}</span>
    </button>
  )
}

/**
 * Πίνακας Απολαβών — γραμμές υπάλληλοι · στήλες ποσά.
 * embedded: ίδιο view με τα tabs (κάτω από τη μπάρα) · αλλιώς fullscreen overlay.
 * Πυκνότητα / πλάτη / σειρά γραμμών & στηλών → localStorage.
 */
export default function EarningsBoardModal({
  open,
  embedded = false,
  personnel = [],
  year,
  month,
  onClose,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [rows, setRows] = useState([])
  const [density, setDensity] = useState(() => loadDensity())
  const [widths, setWidths] = useState(() => loadWidths())
  const [colOrder, setColOrder] = useState(() => loadColOrder())
  const [dragOverId, setDragOverId] = useState(null)
  const [colDragOverKey, setColDragOverKey] = useState(null)
  const [exportChoiceOpen, setExportChoiceOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const resizeRef = useRef(null)
  const dragIdRef = useRef(null)
  const colDragKeyRef = useRef(null)

  const metrics = useMemo(() => metricsInOrder(colOrder), [colOrder])
  const personnelKey = useMemo(() => personnelIdFingerprint(personnel), [personnel])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function load() {
      const idList = personnelKey ? personnelKey.split(',').filter(Boolean) : []
      const cacheKey = boardCacheKey(year, month, idList)
      const hit = boardCache.get(cacheKey)
      const applyRows = (list) => {
        const ordered = applySavedOrder(list, loadOrder())
        setRows(ordered)
        saveOrder(ordered.map((r) => r.techId))
      }

      // Instant paint από cache · soft refresh στο background
      if (hit?.rows?.length) {
        applyRows(hit.rows)
        setLoading(false)
        setError(null)
        boardCache.delete(cacheKey)
        fetchEarningsBoardRows({ personnel, year, month })
          .then((next) => {
            if (!cancelled) applyRows(next)
          })
          .catch(() => {
            /* κράτα cache UI */
          })
        return
      }

      setLoading(true)
      setError(null)
      try {
        const next = await fetchEarningsBoardRows({
          personnel,
          year,
          month,
        })
        if (cancelled) return
        applyRows(next)
      } catch (err) {
        if (!cancelled) {
          setRows([])
          setError(
            formatSupabaseError(err, {
              table: 'tech_ledger_view',
              clientLabel: 'DIAS ERP',
            }) ||
              err?.message ||
              'Αποτυχία φόρτωσης πίνακα απολαβών'
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
  }, [open, personnel, personnelKey, year, month])

  useEffect(() => {
    const onMove = (e) => {
      const r = resizeRef.current
      if (!r) return
      const delta = e.clientX - r.startX
      const next = Math.max(r.minWidth, Math.round(r.startWidth + delta))
      setWidths((prev) => {
        if (prev[r.colId] === next) return prev
        const merged = { ...prev, [r.colId]: next }
        saveWidths(merged)
        return merged
      })
    }
    const onUp = () => {
      if (!resizeRef.current) return
      resizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const startResize = useCallback((colId, e) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = {
      colId,
      startX: e.clientX,
      startWidth: Number(widths[colId]) || minWidthFor(colId),
      minWidth: minWidthFor(colId),
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [widths])

  const cycleDensity = () => {
    setDensity((prev) => {
      const next = nextRowDensity(prev)
      saveDensity(next)
      return next
    })
  }

  const reorderRows = useCallback((fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    setRows((prev) => {
      const fromIdx = prev.findIndex((r) => String(r.techId) === String(fromId))
      const toIdx = prev.findIndex((r) => String(r.techId) === String(toId))
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev
      const next = prev.slice()
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      saveOrder(next.map((r) => r.techId))
      return next
    })
  }, [])

  const reorderColumns = useCallback((fromKey, toKey) => {
    if (!fromKey || !toKey || fromKey === toKey) return
    setColOrder((prev) => {
      const base = prev?.length ? prev.slice() : defaultColOrder()
      const fromIdx = base.indexOf(String(fromKey))
      const toIdx = base.indexOf(String(toKey))
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev
      const next = base.slice()
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      saveColOrder(next)
      return next
    })
  }, [])

  const confirmBoardExport = useCallback(
    async (scope) => {
      if (exporting) return
      setExportChoiceOpen(false)
      setExporting(true)
      try {
        const { rowCount, filename } = await exportEarningsBoardToExcel({
          month,
          year,
          personnel,
          scope,
          rows: scope === 'month' ? rows : null,
        })
        toast.success(
          `Εξαγωγή Πίνακα Απολαβών · ${
            scope === 'year' ? year : `${MONTH_LABELS[Number(month) - 1] || month} ${year}`
          } · ${rowCount} μόνιμοι · ${filename}`
        )
      } catch (err) {
        toast.error(err?.message || 'Αποτυχία εξαγωγής Πίνακα Απολαβών')
      } finally {
        setExporting(false)
      }
    },
    [exporting, month, year, personnel, rows]
  )

  const monthLabel = MONTH_LABELS[Number(month) - 1] || String(month)
  const dens = rowDensityStyles(density)
  const nameW = widths.name || NAME_COL.defaultWidth

  const totals = useMemo(() => {
    const acc = {
      sigma: 0,
      yM: 0,
      yL: 0,
      yTim: 0,
      ticket: 0,
      insurance: 0,
      pi: 0,
      salaryDebit: 0,
      otherDebit: 0,
      invoiceDebit: 0,
    }
    for (const row of rows) {
      const s = row.month || {}
      acc.sigma += Number(s.sigma) || 0
      acc.yM += Number(s.yM) || 0
      acc.yL += Number(s.yL) || 0
      acc.yTim += Number(s.yTim) || 0
      acc.ticket += Number(s.ticket) || 0
      acc.insurance += Number(s.insurance) || 0
      acc.pi += Number(s.pi) || 0
      acc.salaryDebit += Number(s.salaryDebit) || 0
      acc.otherDebit += Number(s.otherDebit) || 0
      acc.invoiceDebit += Number(s.invoiceDebit) || 0
    }
    for (const k of Object.keys(acc)) acc[k] = round2(acc[k])
    return acc
  }, [rows])

  if (!open) return null

  const exportChoiceDialog = exportChoiceOpen
    ? createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-none"
            aria-label="Κλείσιμο"
            disabled={exporting}
            onClick={() => setExportChoiceOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="earnings-board-export-title"
            className="relative w-full max-w-md rounded-2xl border border-emerald-500/35 bg-slate-900 p-5 shadow-2xl shadow-emerald-950/30"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
              Excel
            </p>
            <h3
              id="earnings-board-export-title"
              className="mt-1 text-lg font-bold text-white"
            >
              Πίνακας Απολαβών
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Εξαγωγή υπαλλήλων × ποσά (ίδια σειρά στηλών με τον πίνακα).
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => confirmBoardExport('month')}
                disabled={exporting}
                className="w-full rounded-xl border border-emerald-500/45 bg-emerald-500/20 px-4 py-3 text-left text-sm font-bold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
              >
                Τρέχων μήνας
                <span className="mt-0.5 block text-xs font-semibold text-emerald-100/70">
                  {monthLabel} {year}
                </span>
              </button>
              <button
                type="button"
                onClick={() => confirmBoardExport('year')}
                disabled={exporting}
                className="w-full rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-3 text-left text-sm font-bold text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-50"
              >
                Έτος
                <span className="mt-0.5 block text-xs font-semibold text-cyan-100/70">
                  12 φύλλα · όλο το {year}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setExportChoiceOpen(false)}
                disabled={exporting}
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
              >
                Ακύρωση
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null

  const shellClass = embedded
    ? 'overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl backdrop-blur-md'
    : 'fixed inset-0 z-[80] flex flex-col bg-slate-950'

  const headerClass = embedded
    ? 'flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3'
    : 'flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-slate-900/95 px-4 py-3 sm:px-6'

  return (
    <>
    {exportChoiceDialog}
    <div className={shellClass}>
      <div className={headerClass}>
        <div className="min-w-0">
          {!embedded ? (
            <p className="text-[10px] font-semibold tracking-[0.18em] text-cyan-400/80">
              {greekCapsLabel('Μόνιμοι')}
            </p>
          ) : null}
          <h3
            className={
              embedded
                ? 'text-sm font-semibold text-white'
                : 'truncate text-lg font-bold text-white sm:text-xl'
            }
          >
            Πίνακας Απολαβών · {monthLabel} {year}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Σύρε γραμμές / headers για σειρά · τράβα άκρη στήλης για πλάτος ·{' '}
            {rows.length} μόνιμοι
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setExportChoiceOpen(true)}
            disabled={exporting || loading || rows.length === 0}
            title="Εξαγωγή σε Excel"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 text-[10px] font-bold uppercase tracking-wide text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-3.5 w-3.5"
              aria-hidden
            >
              <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.19L6.72 8.41a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 1 0-1.06-1.06l-2.41 2.41V2.75Z" />
              <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
            </svg>
            {exporting ? '...' : 'Excel'}
          </button>
          <BoardDensityToggle density={density} onCycle={cycleDensity} />
          {!embedded && onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Κλείσιμο
            </button>
          ) : null}
        </div>
      </div>

      <div className={embedded ? 'overflow-x-auto' : 'min-h-0 flex-1 overflow-auto'}>
        {loading ? (
          <p className="py-24 text-center text-sm text-slate-400">Υπολογισμός απολαβών...</p>
        ) : error ? (
          <div className="m-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-24 text-center text-sm text-slate-500">
            Δεν βρέθηκαν ενεργοί μόνιμοι υπάλληλοι με tech_id.
          </p>
        ) : (
          <table
            className={`border-collapse text-left ${dens.tableText}`}
            style={{ tableLayout: 'fixed', width: 'max-content' }}
          >
            <colgroup>
              <col style={{ width: nameW }} />
              {metrics.map((metric) => (
                <col
                  key={metric.key}
                  style={{ width: widths[metric.key] || METRIC_DEFAULT_WIDTH }}
                />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-white/10 bg-slate-900">
                <th
                  className={`sticky left-0 top-0 z-30 border-r border-white/10 bg-slate-900 ${dens.cellPx} ${dens.headPy} relative text-[10px] font-semibold uppercase tracking-wider text-slate-500`}
                  style={{ width: nameW }}
                >
                  Υπάλληλος
                  <span
                    onMouseDown={(e) => startResize('name', e)}
                    className="absolute -right-px top-0 z-20 h-full w-[5px] cursor-col-resize touch-none hover:bg-cyan-400/40 active:bg-cyan-400/60"
                    aria-hidden
                  />
                </th>
                {metrics.map((metric) => {
                  const isColOver = colDragOverKey === metric.key
                  return (
                    <th
                      key={metric.key}
                      draggable
                      onDragStart={(e) => {
                        colDragKeyRef.current = metric.key
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/col-key', metric.key)
                        e.dataTransfer.setData('text/plain', `col:${metric.key}`)
                      }}
                      onDragEnd={() => {
                        colDragKeyRef.current = null
                        setColDragOverKey(null)
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (colDragOverKey !== metric.key) setColDragOverKey(metric.key)
                      }}
                      onDragLeave={() => {
                        if (colDragOverKey === metric.key) setColDragOverKey(null)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const raw =
                          colDragKeyRef.current ||
                          e.dataTransfer.getData('text/col-key') ||
                          e.dataTransfer.getData('text/plain')
                        const fromKey = String(raw || '').replace(/^col:/, '')
                        if (fromKey && METRIC_ROWS.some((m) => m.key === fromKey)) {
                          reorderColumns(fromKey, metric.key)
                        }
                        setColDragOverKey(null)
                      }}
                      className={`sticky top-0 z-20 border-r border-white/5 bg-slate-900 ${dens.cellPx} ${dens.headPy} relative cursor-grab text-center active:cursor-grabbing ${
                        metric.indent ? 'text-slate-400' : 'text-cyan-200'
                      } ${isColOver ? 'bg-cyan-500/20 ring-1 ring-inset ring-cyan-400/40' : ''}`}
                      style={{ width: widths[metric.key] || METRIC_DEFAULT_WIDTH }}
                      title={`${metric.hint || metric.label} — σύρε για αλλαγή θέσης στήλης`}
                    >
                      <span className="block text-[11px] font-bold leading-tight">
                        {metric.label}
                      </span>
                      {metric.hint && density === 0 ? (
                        <span className="mt-0.5 block text-[9px] font-normal text-slate-500">
                          {metric.hint}
                        </span>
                      ) : null}
                      <span
                        onMouseDown={(e) => startResize(metric.key, e)}
                        onDragStart={(e) => e.preventDefault()}
                        draggable={false}
                        className="absolute -right-px top-0 z-20 h-full w-[5px] cursor-col-resize touch-none hover:bg-cyan-400/40 active:bg-cyan-400/60"
                        aria-hidden
                      />
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isDragOver = String(dragOverId) === String(row.techId)
                return (
                  <tr
                    key={row.techId}
                    className={`border-b border-white/5 transition hover:bg-white/[0.03] ${
                      isDragOver ? 'bg-cyan-500/10' : ''
                    }`}
                    onDragOver={(e) => {
                      if (colDragKeyRef.current) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      if (String(dragOverId) !== String(row.techId)) {
                        setDragOverId(row.techId)
                      }
                    }}
                    onDragLeave={() => {
                      if (String(dragOverId) === String(row.techId)) setDragOverId(null)
                    }}
                    onDrop={(e) => {
                      if (colDragKeyRef.current) return
                      e.preventDefault()
                      const raw =
                        dragIdRef.current || e.dataTransfer.getData('text/plain')
                      if (String(raw || '').startsWith('col:')) return
                      reorderRows(raw, row.techId)
                      setDragOverId(null)
                    }}
                  >
                    <th
                      scope="row"
                      draggable
                      onDragStart={(e) => {
                        dragIdRef.current = String(row.techId)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', String(row.techId))
                      }}
                      onDragEnd={() => {
                        dragIdRef.current = null
                        setDragOverId(null)
                      }}
                      className={`sticky left-0 z-10 border-r border-white/10 bg-slate-950 ${dens.cellPx} ${dens.cellPy} cursor-grab text-left font-semibold text-white active:cursor-grabbing`}
                      title={`${row.name} — σύρε για αλλαγή σειράς`}
                      style={{ width: nameW }}
                    >
                      <span className="truncate">{row.name}</span>
                    </th>
                    {metrics.map((metric) => (
                      <td
                        key={`${row.techId}-${metric.key}`}
                        className={`border-r border-white/5 ${dens.cellPx} ${dens.cellPy} text-center font-mono tabular-nums ${dens.monoText} ${
                          metric.indent ? 'text-slate-300' : 'text-slate-100'
                        }`}
                        style={{ width: widths[metric.key] || METRIC_DEFAULT_WIDTH }}
                      >
                        {metric.format(row.month)}
                      </td>
                    ))}
                  </tr>
                )
              })}
              <tr className="border-t border-white/15 bg-slate-900/70">
                <th
                  scope="row"
                  className={`sticky left-0 z-10 border-r border-white/10 bg-slate-900 ${dens.cellPx} ${dens.cellPy} text-left text-[11px] font-bold uppercase tracking-wider text-amber-200`}
                  style={{ width: nameW }}
                >
                  Σύνολο
                </th>
                {metrics.map((metric) => (
                  <td
                    key={`total-${metric.key}`}
                    className={`border-r border-white/5 ${dens.cellPx} ${dens.cellPy} text-center font-mono font-semibold tabular-nums text-amber-100 ${dens.monoText}`}
                    style={{ width: widths[metric.key] || METRIC_DEFAULT_WIDTH }}
                  >
                    {metric.format(totals)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
    </>
  )
}
