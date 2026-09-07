import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { diasClient, formatSupabaseError } from '../lib/supabase'
import { formatElNumber, fromElInputValue, parseElNumber, toElInputDisplay } from '../lib/numberFormat'
import GreekDateInput from './GreekDateInput'
import { parseToIsoDate } from '../lib/greekDate'
import {
  LOAN_DISBURSEMENT_TYPE_ID,
  LOAN_INSTALLMENT_TYPE_ID,
  computeBankInstallments,
  groupLoanEntries,
  isFutureInstallment,
  isLoanDisbursementRow,
  loanCreditCategoryFromRow,
  loanCreditColumnsForCategory,
  loanGroupEntryIds,
  loanPeriodKey,
  loanRowAmount,
  loanSeriesNotesKey,
  paymentTypeForLoanCategory,
  periodAfterOffset,
  rebuildLoanEntryNotes,
} from '../lib/loanUi'
import { MONTH_LABELS } from '../lib/payrollAnalysis'
import ErpWindow from './ErpWindow'

function money(n) {
  return `${formatElNumber(Number(n) || 0)} €`
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function formatMoneyField(n) {
  if (!Number.isFinite(n) || n === 0) return ''
  return toElInputDisplay(String(n))
}

function emptyAdjustForm(startMonth, startYear) {
  return {
    lump_sum: '',
    installment_count: '',
    installment_amount: '',
    start_month: Number(startMonth) || 1,
    start_year: Number(startYear) || new Date().getFullYear(),
  }
}

function periodLabel(month, year) {
  const m = Number(month)
  const y = Number(year)
  const name = m >= 1 && m <= 12 ? MONTH_LABELS[m - 1] : String(m || '—')
  return `${name} ${y || ''}`.trim()
}

function isLumpSumNotes(notes) {
  return /έκτακτη/i.test(String(notes || ''))
}

function installmentLineLabel(row) {
  const notes = String(row?.notes || '')
  if (isLumpSumNotes(notes)) return 'Έκτακτη καταβολή'
  const m = notes.match(/\(Δόση\s*([^)]+)\)/i)
  if (m) return `Δόση ${m[1]}`
  return 'Δόση'
}

/** Timeline zones για μία ομάδα δανείου. */
function buildLoanTimeline(group, asOfMonth, asOfYear) {
  const paid = []
  const future = []
  for (const row of group?.installments || []) {
    if (isFutureInstallment(row, asOfMonth, asOfYear)) future.push(row)
    else paid.push(row)
  }
  paid.sort((a, b) => (loanPeriodKey(a.year, a.month) ?? 0) - (loanPeriodKey(b.year, b.month) ?? 0))
  future.sort((a, b) => (loanPeriodKey(a.year, a.month) ?? 0) - (loanPeriodKey(b.year, b.month) ?? 0))
  return {
    disbursement: group?.disbursement || null,
    paid,
    future,
    paidCount: paid.length,
    futureCount: future.length,
  }
}

/**
 * Οθόνη διαχείρισης δανείων — λίστα + νέο δάνειο + αναπροσαρμογή.
 */
export default function LoanManagementModal({
  open,
  tech,
  selectedMonth,
  analysisYear,
  onClose,
  onSaved,
  onOpenNewLoan,
  loanCreateOpen = false,
}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [adjustGroupId, setAdjustGroupId] = useState(null)
  const [adjustForm, setAdjustForm] = useState(() => emptyAdjustForm(1, new Date().getFullYear()))
  const [saving, setSaving] = useState(false)
  const [expandedPlanId, setExpandedPlanId] = useState(null)
  const [menuOpenId, setMenuOpenId] = useState(null)
  const [editGroupId, setEditGroupId] = useState(null)
  const [editForm, setEditForm] = useState({ grant_date: '', label: '' })
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState(null)
  const prevLoanCreateOpen = useRef(false)
  const menuRef = useRef(null)

  const techId =
    tech?.id != null ? String(tech.id) : tech?.tech_id != null ? String(tech.tech_id) : null
  const techName = tech?.displayName || tech?.name || tech?.tech_name || '—'
  const asOfMonth = Number(selectedMonth) || new Date().getMonth() + 1
  const asOfYear = Number(analysisYear) || new Date().getFullYear()
  const nextStart = periodAfterOffset(asOfMonth, asOfYear, 1)

  const yearOptions = useMemo(() => {
    const base = asOfYear
    const years = []
    for (let y = base - 1; y <= base + 5; y += 1) years.push(y)
    return years
  }, [asOfYear])

  const selectClass =
    'mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50'

  const loadLoans = useCallback(async () => {
    if (!techId) {
      setRows([])
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const { data, error } = await diasClient
        .from('payment_entries')
        .select(
          'id, tech_id, tech_name, type_id, amount, month, year, notes, payment_date, entry_date, loan_batch_id, salary_credit, other_credit, invoice_credit, payment_type, entry_type, created_at'
        )
        .eq('tech_id', techId)
        .in('type_id', [LOAN_INSTALLMENT_TYPE_ID, LOAN_DISBURSEMENT_TYPE_ID])
        .order('year', { ascending: true })
        .order('month', { ascending: true })
        .order('id', { ascending: true })

      if (error) throw error
      setRows(data || [])
    } catch (err) {
      setRows([])
      const msg =
        formatSupabaseError(err, { table: 'payment_entries', clientLabel: 'DIAS ERP' }) ||
        err?.message ||
        String(err)
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [techId])

  useEffect(() => {
    if (!open) return
    setAdjustGroupId(null)
    setAdjustForm(emptyAdjustForm(nextStart.month, nextStart.year))
    setSaving(false)
    setExpandedPlanId(null)
    setMenuOpenId(null)
    setEditGroupId(null)
    setDeleteConfirmGroup(null)
    loadLoans()
  }, [open, loadLoans])

  useEffect(() => {
    if (!menuOpenId) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpenId(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpenId])

  useEffect(() => {
    if (prevLoanCreateOpen.current && !loanCreateOpen && open) {
      loadLoans()
    }
    prevLoanCreateOpen.current = Boolean(loanCreateOpen)
  }, [loanCreateOpen, open, loadLoans])

  const groups = useMemo(
    () => groupLoanEntries(rows, asOfMonth, asOfYear),
    [rows, asOfMonth, asOfYear]
  )

  const patchAdjust = (field, value) => setAdjustForm((prev) => ({ ...prev, [field]: value }))

  const applyBalanceAndCount = (balance, countRaw, prev) => {
    const count = Number(String(countRaw).replace(',', '.'))
    if (balance > 0 && Number.isFinite(count) && count > 0) {
      const { baseInstallment } = computeBankInstallments(balance, count)
      return {
        ...prev,
        installment_count: countRaw,
        installment_amount: formatMoneyField(baseInstallment),
      }
    }
    return { ...prev, installment_count: countRaw }
  }

  const handleLumpChange = (raw) => {
    setAdjustForm((prev) => {
      const next = { ...prev, lump_sum: raw }
      const group = groups.find((g) => g.groupId === adjustGroupId)
      const remaining = Number(group?.remainingAmount) || 0
      const lump = parseElNumber(raw) || 0
      const newBalance = round2(Math.max(0, remaining - lump))
      return applyBalanceAndCount(newBalance, next.installment_count, next)
    })
  }

  const handleCountChange = (raw) => {
    setAdjustForm((prev) => {
      const group = groups.find((g) => g.groupId === adjustGroupId)
      const remaining = Number(group?.remainingAmount) || 0
      const lump = parseElNumber(prev.lump_sum) || 0
      const newBalance = round2(Math.max(0, remaining - lump))
      return applyBalanceAndCount(newBalance, raw, prev)
    })
  }

  const handleInstallmentChange = (raw) => {
    setAdjustForm((prev) => {
      const group = groups.find((g) => g.groupId === adjustGroupId)
      const remaining = Number(group?.remainingAmount) || 0
      const lump = parseElNumber(prev.lump_sum) || 0
      const newBalance = round2(Math.max(0, remaining - lump))
      const installment = parseElNumber(raw)
      if (installment != null && installment > 0 && newBalance > 0) {
        const count = Math.max(1, Math.round(newBalance / installment))
        const { baseInstallment } = computeBankInstallments(newBalance, count)
        return {
          ...prev,
          installment_amount: formatMoneyField(baseInstallment),
          installment_count: String(count),
        }
      }
      return { ...prev, installment_amount: raw }
    })
  }

  const openAdjust = (group) => {
    if (!group || !(group.remainingAmount > 0)) {
      toast.error('Δεν υπάρχει υπόλοιπο προς αναπροσαρμογή')
      return
    }
    setEditGroupId(null)
    setMenuOpenId(null)
    setDeleteConfirmGroup(null)
    setAdjustGroupId(group.groupId)
    setAdjustForm(emptyAdjustForm(nextStart.month, nextStart.year))
  }

  const cancelAdjust = () => {
    setAdjustGroupId(null)
    setAdjustForm(emptyAdjustForm(nextStart.month, nextStart.year))
  }

  const openEdit = (group) => {
    setMenuOpenId(null)
    setAdjustGroupId(null)
    setDeleteConfirmGroup(null)
    const grantRaw =
      group.disbursement?.payment_date ||
      group.disbursement?.entry_date ||
      group.installments?.[0]?.payment_date ||
      ''
    setEditGroupId(group.groupId)
    setEditForm({
      grant_date: grantRaw ? String(grantRaw).slice(0, 10) : '',
      label: group.label || 'Δάνειο',
    })
  }

  const cancelEdit = () => {
    setEditGroupId(null)
    setEditForm({ grant_date: '', label: '' })
  }

  const handleSaveEdit = async (group) => {
    if (!group || saving || !techId) return
    const grantDate =
      parseToIsoDate(editForm.grant_date) ||
      (typeof editForm.grant_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(editForm.grant_date)
        ? editForm.grant_date.slice(0, 10)
        : null)
    if (!grantDate) {
      toast.error('Μη έγκυρη ημερομηνία χορήγησης')
      return
    }
    const newLabel = String(editForm.label || '').trim() || 'Δάνειο'
    const entries = [
      ...(group.disbursement ? [group.disbursement] : []),
      ...(group.installments || []),
    ]
    if (entries.length === 0) {
      toast.error('Δεν βρέθηκαν εγγραφές για ενημέρωση')
      return
    }

    const grantMonth = Number(String(grantDate).slice(5, 7))
    const grantYear = Number(String(grantDate).slice(0, 4))

    setSaving(true)
    try {
      for (const row of entries) {
        const payload = {
          notes: rebuildLoanEntryNotes(row.notes, newLabel),
        }
        if (isLoanDisbursementRow(row)) {
          payload.payment_date = grantDate
          payload.entry_date = grantDate
          payload.month = grantMonth
          payload.year = grantYear
        }
        const { error } = await diasClient
          .from('payment_entries')
          .update(payload)
          .eq('id', row.id)
          .in('type_id', [LOAN_INSTALLMENT_TYPE_ID, LOAN_DISBURSEMENT_TYPE_ID])
        if (error) throw error
      }
      toast.success('Τα στοιχεία του δανείου ενημερώθηκαν')
      cancelEdit()
      setExpandedPlanId(group.groupId)
      await loadLoans()
      await onSaved?.({ wasPayment: true })
    } catch (err) {
      const msg =
        formatSupabaseError(err, { table: 'payment_entries', clientLabel: 'DIAS ERP' }) ||
        err?.message ||
        String(err)
      toast.error(msg || 'Αποτυχία ενημέρωσης')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    const group = deleteConfirmGroup
    if (!group || saving || !techId) return
    const ids = loanGroupEntryIds(group)
    if (ids.length === 0) {
      toast.error('Δεν βρέθηκαν εγγραφές για διαγραφή')
      return
    }

    setSaving(true)
    try {
      if (group.loanBatchId) {
        const { error } = await diasClient
          .from('payment_entries')
          .delete()
          .eq('tech_id', techId)
          .eq('loan_batch_id', group.loanBatchId)
          .in('type_id', [LOAN_INSTALLMENT_TYPE_ID, LOAN_DISBURSEMENT_TYPE_ID])
        if (error) throw error
      } else {
        const { error } = await diasClient
          .from('payment_entries')
          .delete()
          .in('id', ids)
          .in('type_id', [LOAN_INSTALLMENT_TYPE_ID, LOAN_DISBURSEMENT_TYPE_ID])
        if (error) throw error
      }
      toast.success('Το δάνειο διαγράφηκε πλήρως')
      setDeleteConfirmGroup(null)
      setMenuOpenId(null)
      setEditGroupId(null)
      setAdjustGroupId(null)
      setExpandedPlanId(null)
      await loadLoans()
      await onSaved?.({ wasPayment: true })
    } catch (err) {
      const msg =
        formatSupabaseError(err, { table: 'payment_entries', clientLabel: 'DIAS ERP' }) ||
        err?.message ||
        String(err)
      toast.error(msg || 'Αποτυχία διαγραφής')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmAdjust = async (group) => {
    if (!group || saving || !techId) return

    const remaining = Number(group.remainingAmount) || 0
    const lump = parseElNumber(adjustForm.lump_sum) || 0
    if (lump < 0) {
      toast.error('Μη έγκυρη έκτακτη καταβολή')
      return
    }
    if (lump > remaining + 0.001) {
      toast.error('Η έκτακτη καταβολή δεν μπορεί να υπερβαίνει το υπόλοιπο')
      return
    }
    const newBalance = round2(remaining - lump)
    const newCount = Math.floor(Number(String(adjustForm.installment_count).replace(',', '.')))

    if (!(remaining > 0)) {
      toast.error('Δεν υπάρχει υπόλοιπο προς αναπροσαρμογή')
      return
    }
    if (newBalance > 0 && (!Number.isFinite(newCount) || newCount < 1)) {
      toast.error('Συμπλήρωσε έγκυρο αριθμό δόσεων για το νέο υπόλοιπο')
      return
    }
    if (newBalance <= 0 && lump <= 0) {
      toast.error('Δώσε έκτακτη καταβολή ή νέο δοσολόγιο')
      return
    }

    const startMonth = Number(adjustForm.start_month)
    const startYear = Number(adjustForm.start_year)
    if (newBalance > 0 && (!(startMonth >= 1 && startMonth <= 12) || !Number.isFinite(startYear))) {
      toast.error('Μη έγκυρη έναρξη νέων δόσεων')
      return
    }

    const futureRows = (group.installments || []).filter((r) =>
      isFutureInstallment(r, asOfMonth, asOfYear)
    )
    if (futureRows.length === 0) {
      toast.error('Δεν βρέθηκαν μελλοντικές δόσεις για διαγραφή')
      return
    }

    const templateRow = futureRows[0] || group.installments[0] || group.disbursement
    const category = loanCreditCategoryFromRow(templateRow)
    const paymentType = paymentTypeForLoanCategory(category)

    let baseInstallment = null
    let lastInstallment = null
    if (newBalance > 0) {
      ;({ baseInstallment, lastInstallment } = computeBankInstallments(newBalance, newCount))
      if (baseInstallment == null || lastInstallment == null) {
        toast.error('Αδυναμία υπολογισμού δόσεων')
        return
      }
    }

    const grantDateRaw =
      group.disbursement?.payment_date ||
      group.disbursement?.entry_date ||
      templateRow?.payment_date ||
      templateRow?.entry_date
    const grantDate = grantDateRaw ? String(grantDateRaw).slice(0, 10) : null
    if (!grantDate || !/^\d{4}-\d{2}-\d{2}$/.test(grantDate)) {
      toast.error('Λείπει ημερομηνία χορήγησης του δανείου')
      return
    }

    const loanBatchId = group.loanBatchId || null
    const baseNotes = group.label || loanSeriesNotesKey(templateRow?.notes) || 'Δάνειο'
    const futureIds = futureRows.map((r) => r.id).filter(Boolean)
    const techNameDb = tech?.displayName || tech?.name || tech?.tech_name || null

    setSaving(true)
    try {
      if (loanBatchId) {
        const { data: toDelete, error: selErr } = await diasClient
          .from('payment_entries')
          .select('id, month, year, type_id')
          .eq('tech_id', techId)
          .eq('type_id', LOAN_INSTALLMENT_TYPE_ID)
          .eq('loan_batch_id', loanBatchId)
        if (selErr) throw selErr

        const ids = (toDelete || [])
          .filter((r) => isFutureInstallment(r, asOfMonth, asOfYear))
          .map((r) => r.id)
          .filter(Boolean)

        if (ids.length === 0) {
          toast.error('Δεν βρέθηκαν μελλοντικές δόσεις για διαγραφή')
          setSaving(false)
          return
        }

        const { error: delErr } = await diasClient
          .from('payment_entries')
          .delete()
          .in('id', ids)
          .eq('type_id', LOAN_INSTALLMENT_TYPE_ID)
        if (delErr) throw delErr
      } else {
        if (futureIds.length === 0) {
          toast.error('Δεν βρέθηκαν μελλοντικές δόσεις (legacy)')
          setSaving(false)
          return
        }
        const { error: delErr } = await diasClient
          .from('payment_entries')
          .delete()
          .in('id', futureIds)
          .eq('type_id', LOAN_INSTALLMENT_TYPE_ID)
        if (delErr) throw delErr
      }

      const entriesData = []

      if (lump > 0) {
        entriesData.push({
          tech_id: techId,
          tech_name: techNameDb,
          payment_date: grantDate,
          entry_date: grantDate,
          entry_type: paymentType,
          month: asOfMonth,
          year: asOfYear,
          type_id: LOAN_INSTALLMENT_TYPE_ID,
          payment_type: paymentType,
          amount: lump,
          ...loanCreditColumnsForCategory(category, lump),
          notes: `${baseNotes} (Έκτακτη καταβολή)`,
          description: null,
          loan_batch_id: loanBatchId,
        })
      }

      if (newBalance > 0 && newCount >= 1) {
        for (let i = 0; i < newCount; i += 1) {
          const { month, year } = periodAfterOffset(startMonth, startYear, i)
          const amount = i === newCount - 1 ? lastInstallment : baseInstallment
          entriesData.push({
            tech_id: techId,
            tech_name: techNameDb,
            payment_date: grantDate,
            entry_date: grantDate,
            entry_type: paymentType,
            month,
            year,
            type_id: LOAN_INSTALLMENT_TYPE_ID,
            payment_type: paymentType,
            amount,
            ...loanCreditColumnsForCategory(category, amount),
            notes: `${baseNotes} (Δόση ${i + 1}/${newCount})`,
            description: null,
            loan_batch_id: loanBatchId,
          })
        }
      }

      if (entriesData.length === 0) {
        toast.error('Δεν προέκυψαν νέες εγγραφές')
        setSaving(false)
        return
      }

      const { error: insErr } = await diasClient.from('payment_entries').insert(entriesData)
      if (insErr) throw insErr

      toast.success('Το δάνειο αναπροσαρμόστηκε')
      const expandId = group.groupId
      cancelAdjust()
      setExpandedPlanId(expandId)
      await loadLoans()
      await onSaved?.({ wasPayment: true })
    } catch (err) {
      const msg =
        formatSupabaseError(err, { table: 'payment_entries', clientLabel: 'DIAS ERP' }) ||
        err?.message ||
        String(err)
      toast.error(msg || 'Αποτυχία αναπροσαρμογής')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const asOfLabel = `${MONTH_LABELS[asOfMonth - 1] || asOfMonth} ${asOfYear}`

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/20 backdrop-blur-none"
        aria-label="Κλείσιμο"
        onClick={onClose}
        disabled={saving || loanCreateOpen}
      />
      <ErpWindow
        className="!bg-slate-900"
        titleBar={
          <div className="flex w-full min-w-0 items-start justify-between gap-3 pr-1">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-400/80">
                Δάνεια
              </p>
              <h3 id="loan-mgmt-title" className="truncate text-lg font-bold text-white">
                Διαχείριση Δανείων
              </h3>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {techName} · as-of {asOfLabel}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenNewLoan?.()}
                disabled={!techId || saving || !onOpenNewLoan}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/50 bg-emerald-500/25 px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-emerald-50 shadow-lg shadow-emerald-950/30 transition hover:border-emerald-300/60 hover:bg-emerald-500/35 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                Νέο Δάνειο
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-50"
              >
                ✕
              </button>
            </div>
          </div>
        }
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="loan-mgmt-title"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <p className="py-10 text-center text-sm text-slate-400">Φόρτωση δανείων...</p>
          )}

          {loadError && !loading && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {loadError}
            </div>
          )}

          {!loading && !loadError && groups.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/15 bg-slate-950/40 px-4 py-10 text-center">
              <p className="text-sm text-slate-400">
                Δεν βρέθηκαν δάνεια (τύποι 94/95) για αυτόν τον τεχνικό.
              </p>
              <button
                type="button"
                onClick={() => onOpenNewLoan?.()}
                disabled={!techId || !onOpenNewLoan}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wide text-emerald-50 hover:bg-emerald-500/30 disabled:opacity-40"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                Δημιουργία πρώτου δανείου
              </button>
            </div>
          )}

          {!loading && !loadError && groups.length > 0 && (
            <ul className="space-y-3">
              {groups.map((g) => {
                const grantDate = g.disbursement?.payment_date || g.disbursement?.entry_date
                const grantLabel = grantDate
                  ? String(grantDate).slice(0, 10).split('-').reverse().join('/')
                  : '—'
                const isAdjusting = adjustGroupId === g.groupId
                const isEditing = editGroupId === g.groupId
                const canAdjust = g.remainingAmount > 0
                const planOpen = expandedPlanId === g.groupId
                const menuOpen = menuOpenId === g.groupId
                const timeline = buildLoanTimeline(g, asOfMonth, asOfYear)
                const progressPct =
                  g.initialAmount > 0
                    ? Math.min(100, Math.round((g.paidAmount / g.initialAmount) * 100))
                    : g.remainingAmount <= 0
                      ? 100
                      : 0
                const isSettled = !(g.remainingAmount > 0)

                const lumpPreview = isAdjusting ? parseElNumber(adjustForm.lump_sum) || 0 : 0
                const newBalancePreview = isAdjusting
                  ? round2(Math.max(0, Number(g.remainingAmount) - lumpPreview))
                  : 0
                const previewCount = isAdjusting
                  ? Math.floor(Number(String(adjustForm.installment_count).replace(',', '.')))
                  : 0
                const preview =
                  isAdjusting && newBalancePreview > 0 && previewCount >= 1
                    ? computeBankInstallments(newBalancePreview, previewCount)
                    : null

                return (
                  <li
                    key={g.groupId}
                    className="rounded-xl border border-white/10 bg-slate-950/50 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-white">{g.label}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              isSettled
                                ? 'border border-white/15 bg-white/5 text-slate-400'
                                : 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-100'
                            }`}
                          >
                            {isSettled ? 'Εξοφλημένο' : 'Ενεργό'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Χορήγηση {grantLabel}
                          {' · '}
                          <span className="text-slate-400">
                            {timeline.paidCount} πληρωμένες · {timeline.futureCount} εκκρεμείς
                          </span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPlanId((id) => (id === g.groupId ? null : g.groupId))
                          }
                          className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
                        >
                          Πλάνο {planOpen ? '▴' : '▾'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            cancelEdit()
                            openAdjust(g)
                          }}
                          disabled={!canAdjust || saving || isAdjusting || isEditing || loanCreateOpen}
                          title={
                            canAdjust
                              ? 'Αναπροσαρμογή μελλοντικών δόσεων'
                              : 'Δεν υπάρχει υπόλοιπο'
                          }
                          className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Αναπροσαρμογή
                        </button>
                        <div className="relative" ref={menuOpen ? menuRef : undefined}>
                          <button
                            type="button"
                            onClick={() =>
                              setMenuOpenId((id) => (id === g.groupId ? null : g.groupId))
                            }
                            disabled={saving || loanCreateOpen}
                            title="Ενέργειες"
                            className="rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm font-bold text-slate-200 hover:bg-white/10 disabled:opacity-40"
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                          >
                            ⋮
                          </button>
                          {menuOpen && (
                            <div
                              role="menu"
                              className="absolute right-0 z-20 mt-1 min-w-[10rem] overflow-hidden rounded-xl border border-white/10 bg-slate-900 py-1 shadow-xl"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => openEdit(g)}
                                className="block w-full px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-white/10"
                              >
                                Επεξεργασία
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setMenuOpenId(null)
                                  setEditGroupId(null)
                                  setAdjustGroupId(null)
                                  setDeleteConfirmGroup(g)
                                }}
                                className="block w-full px-3 py-2 text-left text-xs font-semibold text-rose-300 hover:bg-rose-500/15"
                              >
                                Διαγραφή
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg border border-white/5 bg-slate-900/60 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">
                          Αρχικό
                        </p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-cyan-100">
                          {money(g.initialAmount)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-slate-900/60 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">
                          Πληρωμένο
                        </p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-emerald-100">
                          {money(g.paidAmount)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-slate-900/60 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">
                          Υπόλοιπο
                        </p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-amber-100">
                          {money(g.remainingAmount)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
                        <span>Εξόφληση</span>
                        <span className="font-mono">{progressPct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isSettled ? 'bg-slate-500' : 'bg-emerald-500/80'
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    {planOpen && (
                      <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-slate-900/50 p-3">
                        {timeline.disbursement && (
                          <div>
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400/80">
                              Χορήγηση
                            </p>
                            <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-cyan-50">Εκταμίευση</p>
                                <p className="text-[11px] text-cyan-200/70">
                                  {periodLabel(
                                    timeline.disbursement.month,
                                    timeline.disbursement.year
                                  )}
                                </p>
                              </div>
                              <p className="shrink-0 font-mono text-sm font-semibold text-cyan-100">
                                {money(loanRowAmount(timeline.disbursement))}
                              </p>
                            </div>
                          </div>
                        )}

                        {timeline.paid.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                              Εξοφλημένα
                            </p>
                            <ul className="space-y-1">
                              {timeline.paid.map((row) => {
                                const lump = isLumpSumNotes(row.notes)
                                return (
                                  <li
                                    key={row.id}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-slate-950/40 px-3 py-1.5 opacity-60"
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span className="text-[11px] text-emerald-400/80" aria-hidden>
                                        ✔
                                      </span>
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <p className="text-xs text-slate-300">
                                            {installmentLineLabel(row)}
                                          </p>
                                          {lump && (
                                            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-100">
                                              Έκτακτη
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[11px] text-slate-500">
                                          {periodLabel(row.month, row.year)}
                                        </p>
                                      </div>
                                    </div>
                                    <p className="shrink-0 font-mono text-xs text-slate-400">
                                      {money(loanRowAmount(row))}
                                    </p>
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        )}

                        {timeline.future.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
                              Επόμενες
                            </p>
                            <ul className="space-y-1">
                              {timeline.future.map((row, idx) => (
                                <li key={row.id}>
                                  {idx === 0 && (
                                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200/70">
                                      Τώρα →
                                    </p>
                                  )}
                                  <div
                                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 ${
                                      idx === 0
                                        ? 'border-l-2 border-amber-400/60 border-y-white/10 border-r-white/10 bg-amber-500/10'
                                        : 'border-white/10 bg-slate-950/30'
                                    }`}
                                  >
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium text-slate-100">
                                        {installmentLineLabel(row)}
                                      </p>
                                      <p className="text-[11px] text-slate-400">
                                        {periodLabel(row.month, row.year)}
                                      </p>
                                    </div>
                                    <p className="shrink-0 font-mono text-xs font-semibold text-slate-100">
                                      {money(loanRowAmount(row))}
                                    </p>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {!timeline.disbursement &&
                          timeline.paid.length === 0 &&
                          timeline.future.length === 0 && (
                            <p className="text-center text-xs text-slate-500">
                              Δεν υπάρχουν εγγραφές πλάνου.
                            </p>
                          )}
                      </div>
                    )}

                    {isEditing && (
                      <div className="mt-3 space-y-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3">
                        <p className="text-sm font-semibold text-cyan-50">Επεξεργασία στοιχείων</p>
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-cyan-100/80">
                            Ημερομηνία χορήγησης
                          </label>
                          <GreekDateInput
                            value={editForm.grant_date || ''}
                            onChange={(iso) => setEditForm((prev) => ({ ...prev, grant_date: iso }))}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-cyan-100/80">
                            Αιτιολογία / λεκτικό
                          </label>
                          <input
                            type="text"
                            value={editForm.label}
                            onChange={(e) =>
                              setEditForm((prev) => ({ ...prev, label: e.target.value }))
                            }
                            disabled={saving}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50 disabled:opacity-50"
                          />
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-300">
                          Για αλλαγή ποσών ή δοσολογίου, χρησιμοποιήστε την Αναπροσαρμογή, ή
                          διαγράψτε και δημιουργήστε ξανά το δάνειο.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(g)}
                            disabled={saving}
                            className="rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-sm font-bold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
                          >
                            {saving ? 'Αποθήκευση...' : 'Αποθήκευση'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={saving}
                            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
                          >
                            Ακύρωση
                          </button>
                        </div>
                      </div>
                    )}

                    {isAdjusting && (
                      <div className="mt-3 space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                        <p className="text-sm text-amber-50">
                          Τρέχον υπόλοιπο:{' '}
                          <span className="font-mono font-semibold">{money(g.remainingAmount)}</span>
                        </p>

                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-amber-100/80">
                            Έκτακτη καταβολή (€) — προαιρετικό
                          </label>
                          <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={toElInputDisplay(adjustForm.lump_sum)}
                              onChange={(e) => handleLumpChange(fromElInputValue(e.target.value))}
                              disabled={saving}
                              placeholder="0,00"
                              className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 font-mono text-sm text-white outline-none focus:border-amber-400/50 disabled:opacity-50"
                            />
                            <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-200/80">
                                Υπόλοιπο για δόσεις
                              </p>
                              <p className="mt-0.5 font-mono text-base font-bold text-cyan-50">
                                {money(newBalancePreview)}
                              </p>
                            </div>
                          </div>
                          <p className="mt-1.5 text-[11px] text-slate-400">
                            {money(g.remainingAmount)} − έκτακτη {money(lumpPreview)} ={' '}
                            <span className="font-semibold text-amber-100">
                              {money(newBalancePreview)}
                            </span>
                            {lumpPreview > 0 && (
                              <span>
                                {' '}
                                · η έκτακτη καταχωρείται στον {asOfLabel}
                              </span>
                            )}
                          </p>
                        </div>

                        {newBalancePreview > 0 && (
                          <>
                            <div>
                              <label className="text-[10px] font-semibold uppercase tracking-wider text-amber-100/80">
                                Έναρξη νέων δόσεων
                              </label>
                              <div className="mt-1 grid grid-cols-2 gap-3">
                                <select
                                  value={adjustForm.start_month}
                                  onChange={(e) =>
                                    patchAdjust('start_month', Number(e.target.value))
                                  }
                                  disabled={saving}
                                  className={selectClass}
                                >
                                  {MONTH_LABELS.map((label, i) => (
                                    <option key={label} value={i + 1}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={adjustForm.start_year}
                                  onChange={(e) =>
                                    patchAdjust('start_year', Number(e.target.value))
                                  }
                                  disabled={saving}
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
                              <label className="text-[10px] font-semibold uppercase tracking-wider text-amber-100/80">
                                Δοσολόγιο (νέο υπόλοιπο)
                              </label>
                              <div className="mt-1 flex flex-col gap-3 sm:flex-row">
                                <div className="min-w-0 flex-1">
                                  <label className="text-[10px] text-slate-400">
                                    Αριθμός δόσεων
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={adjustForm.installment_count}
                                    onChange={(e) =>
                                      handleCountChange(e.target.value.replace(/[^\d]/g, ''))
                                    }
                                    disabled={saving}
                                    placeholder="π.χ. 6"
                                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 font-mono text-sm text-white outline-none focus:border-amber-400/50 disabled:opacity-50"
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <label className="text-[10px] text-slate-400">Ποσό δόσης (€)</label>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={toElInputDisplay(adjustForm.installment_amount)}
                                    onChange={(e) =>
                                      handleInstallmentChange(fromElInputValue(e.target.value))
                                    }
                                    disabled={saving}
                                    placeholder="αυτόματα"
                                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 font-mono text-sm text-white outline-none focus:border-amber-400/50 disabled:opacity-50"
                                  />
                                </div>
                              </div>
                              {preview?.baseInstallment != null && (
                                <p className="mt-1.5 text-[11px] text-amber-100/80">
                                  Δόση ≈ {money(preview.baseInstallment)}
                                  {previewCount > 1 &&
                                    Number(preview.lastInstallment) !==
                                      Number(preview.baseInstallment) &&
                                    ` · τελευταία ${money(preview.lastInstallment)}`}
                                </p>
                              )}
                            </div>
                          </>
                        )}

                        {newBalancePreview <= 0 && lumpPreview > 0 && (
                          <p className="text-[11px] text-emerald-200/90">
                            Πλήρης εξόφληση με έκτακτη καταβολή — δεν θα δημιουργηθούν νέες δόσεις.
                          </p>
                        )}

                        <p className="text-[11px] leading-relaxed text-slate-300">
                          Διαγράφονται μόνο οι μελλοντικές δόσεις. Η εκταμίευση (95) και οι ήδη
                          πληρωμένες/τρέχουσες δόσεις δεν αλλάζουν.
                        </p>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleConfirmAdjust(g)}
                            disabled={saving}
                            className="rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-sm font-bold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
                          >
                            {saving ? 'Αποθήκευση...' : 'Επιβεβαίωση'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelAdjust}
                            disabled={saving}
                            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
                          >
                            Ακύρωση
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 px-5 py-3">
            <button
              type="button"
              onClick={loadLoans}
              disabled={loading || saving || loanCreateOpen}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              Ανανέωση
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-sm font-bold text-rose-100 disabled:opacity-50"
            >
              Έξοδος
            </button>
          </div>
        </div>
      </ErpWindow>

      {deleteConfirmGroup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-none"
            aria-label="Κλείσιμο"
            onClick={() => !saving && setDeleteConfirmGroup(null)}
            disabled={saving}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="loan-delete-title"
            className="relative w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-5 shadow-2xl"
          >
            <h3 id="loan-delete-title" className="text-lg font-bold text-rose-100">
              Διαγραφή δανείου
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              <span className="font-semibold text-rose-200">ΠΡΟΣΟΧΗ:</span> Θα διαγραφεί πλήρως η
              εκταμίευση και <span className="font-semibold">ΟΛΕΣ</span> οι δόσεις (παρελθοντικές και
              μελλοντικές) του «{deleteConfirmGroup.label}». Η ενέργεια δεν αναιρείται. Είστε
              σίγουροι;
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={saving}
                className="rounded-xl border border-rose-500/50 bg-rose-600/30 px-4 py-2.5 text-sm font-bold text-rose-100 hover:bg-rose-600/45 disabled:opacity-50"
              >
                {saving ? 'Διαγραφή...' : 'Ναι, διαγραφή όλων'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmGroup(null)}
                disabled={saving}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                Ακύρωση
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
