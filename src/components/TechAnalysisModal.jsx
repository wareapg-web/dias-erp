import React, { useEffect, useMemo, useState } from 'react'
import { adminClient, diasClient, safeQuery, isMissingTableError, formatSupabaseError } from '../lib/supabase'
import {
  buildMonthlyPayroll,
  mapAssignmentRow,
  mapDailyStatusRow,
  mapJobRow,
} from '../lib/crewPayroll'
import {
  MONTH_LABELS,
  MONTH_SHORT,
  splitTechName,
  techHireDate,
  techPhotoUrl,
  buildSalaryYearMatrix,
  estimateAmount,
  formatEuro,
  formatEuroPlain,
} from '../lib/payrollAnalysis'
import {
  EARNINGS_ROW_DEFS,
  emptyEarningsForm,
  earningsFromDb,
  earningsToDb,
  earningsTotal,
} from '../lib/techEarnings'
import {
  AGREEMENT_TYPES,
  agreementRpcArgs,
  agreementTypeLabel,
  emptyAgreementForm,
  formatAgreementAmount,
} from '../lib/techAgreements'
import {
  PAYMENT_TYPES,
  emptyPaymentForm,
  formatPaymentAmount,
  paymentToDb,
  paymentTypeLabel,
} from '../lib/techPayments'
import {
  computeLedgerBalances,
  ledgerRowKey,
  monthDateRange,
  buildLedgerDescriptionForType,
  buildLedgerAmountForType,
} from '../lib/techLedger'
import {
  buildTemplateMergeRows,
  resolveLedgerSide,
  visibleTransactionTypes,
} from '../lib/ledgerMapping'
import { importMonthFromAgreements } from '../lib/monthImport'
import { transferHoursToLedger } from '../lib/transferHours'
import {
  buildTypeLookup,
  fetchTransactionTypes,
  resolveTransactionType,
} from '../lib/transactionTypes'
import { employmentLabel, personnelIssuesInvoice } from '../lib/personnel'
import PersonnelPanel from './PersonnelPanel'
import MovementModal from './MovementModal'
import LedgerAnalysisGrid from './LedgerAnalysisGrid'

export default function TechAnalysisModal({
  tech,
  techList,
  onTechChange,
  adminTechs = [],
  personnel = [],
  selectedPersonId = null,
  onPersonSelect,
  onPersonnelMutated,
  initialMonth,
  initialYear,
  saving,
  onClose,
  onSaveToErp,
  embedded = false,
  payrolls = [],
}) {
  const [analysisYear, setAnalysisYear] = useState(initialYear)
  const [selectedMonth, setSelectedMonth] = useState(initialMonth)
  const [assignments, setAssignments] = useState([])
  const [jobs, setJobs] = useState([])
  const [dailyStatus, setDailyStatus] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [activeTab, setActiveTab] = useState('analysis')
  const [techSearch, setTechSearch] = useState('')
  const [earningsForm, setEarningsForm] = useState(emptyEarningsForm)
  const [earningsRecordId, setEarningsRecordId] = useState(null)
  const [earningsLoading, setEarningsLoading] = useState(false)
  const [earningsSaving, setEarningsSaving] = useState(false)
  const [earningsError, setEarningsError] = useState(null)
  const [earningsMissing, setEarningsMissing] = useState(false)
  const [earningsDirty, setEarningsDirty] = useState(false)
  const [agreements, setAgreements] = useState([])
  const [agreementsLoading, setAgreementsLoading] = useState(false)
  const [agreementsSaving, setAgreementsSaving] = useState(false)
  const [agreementsError, setAgreementsError] = useState(null)
  const [agreementsMissing, setAgreementsMissing] = useState(false)
  const [agreementForm, setAgreementForm] = useState(emptyAgreementForm)
  const [payments, setPayments] = useState([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [paymentsSaving, setPaymentsSaving] = useState(false)
  const [paymentsError, setPaymentsError] = useState(null)
  const [paymentsMissing, setPaymentsMissing] = useState(false)
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm)
  const [ledgerRows, setLedgerRows] = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState(null)
  const [ledgerMissing, setLedgerMissing] = useState(false)
  const [ledgerTick, setLedgerTick] = useState(0)
  const [monthImportSaving, setMonthImportSaving] = useState(false)
  const [monthImportMessage, setMonthImportMessage] = useState(null)
  const [hoursTransferSaving, setHoursTransferSaving] = useState(false)
  const [movementOpen, setMovementOpen] = useState(false)
  const [selectedRowData, setSelectedRowData] = useState(null)
  const [selectedLedgerRowKey, setSelectedLedgerRowKey] = useState(null)
  const [movementPresetTypeId, setMovementPresetTypeId] = useState(null)
  const [movementPresetSide, setMovementPresetSide] = useState(null)
  const [movementPresetDescription, setMovementPresetDescription] = useState(null)
  const [movementPresetAmount, setMovementPresetAmount] = useState(null)
  const [transactionTypes, setTransactionTypes] = useState([])
  const [transactionTypesError, setTransactionTypesError] = useState(null)

  useEffect(() => {
    setAnalysisYear(initialYear)
    setSelectedMonth(initialMonth)
  }, [tech?.id, initialYear, initialMonth])

  useEffect(() => {
    let cancelled = false
    async function loadTransactionTypes() {
      try {
        const list = await fetchTransactionTypes()
        if (!cancelled) {
          setTransactionTypes(list)
          setTransactionTypesError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setTransactionTypes([])
          setTransactionTypesError(
            formatSupabaseError(err, { table: 'transaction_types', clientLabel: 'DIAS ERP' }) ||
              'Τρέξε supabase/07_transaction_types_ledger_group.sql στο DIAS.'
          )
        }
      }
    }
    loadTransactionTypes()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!tech) return

    let cancelled = false
    /** Ώρες μόνο αν υπάρχει σύνδεση με Admin (όνομα βάρδιας). */
    const hoursName = tech._adminTech?.name || (tech.admin_tech_id ? tech.name : null)

    async function loadLegacyData() {
      try {
        setLoading(true)
        setLoadError(null)

        if (!hoursName) {
          setAssignments([])
          setJobs([])
          setDailyStatus([])
          setLoadError(null)
          setLoading(false)
          return
        }

        const from = `${analysisYear}-01-01`
        const to = `${analysisYear}-12-31`

        const [assignmentsRes, jobsRes, statusRes] = await Promise.all([
          safeQuery(
            adminClient
              .from('assignments')
              .select('*')
              .eq('tech', hoursName)
              .gte('date_iso', from)
              .lte('date_iso', to),
            { table: 'assignments', clientLabel: 'Admin App' }
          ),
          safeQuery(adminClient.from('jobs').select('group_id, name'), {
            table: 'jobs',
            clientLabel: 'Admin App',
          }),
          safeQuery(
            adminClient
              .from('daily_status')
              .select('*')
              .eq('tech', hoursName)
              .gte('date_iso', from)
              .lte('date_iso', to),
            { table: 'daily_status', clientLabel: 'Admin App' }
          ),
        ])

        if (cancelled) return

        const errors = [assignmentsRes, jobsRes, statusRes]
          .filter((r) => r.error)
          .map((r) => r.error)

        setAssignments((assignmentsRes.data || []).map(mapAssignmentRow))
        setJobs((jobsRes.data || []).map(mapJobRow))
        setDailyStatus((statusRes.data || []).map(mapDailyStatusRow))
        setLoadError(errors.length ? errors.join(' · ') : null)
      } catch (err) {
        if (!cancelled) setLoadError(err.message || String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadLegacyData()
    return () => {
      cancelled = true
    }
  }, [tech, analysisYear])

  useEffect(() => {
    if (!tech) {
      setEarningsForm(emptyEarningsForm())
      setEarningsRecordId(null)
      setEarningsDirty(false)
      return
    }

    let cancelled = false

    async function loadEarnings() {
      setEarningsLoading(true)
      setEarningsError(null)
      try {
        const { data, error } = await diasClient
          .from('tech_earnings')
          .select('*')
          .eq('tech_id', String(tech.id))
          .maybeSingle()

        if (cancelled) return

        if (error) {
          setEarningsMissing(isMissingTableError(error))
          setEarningsError(formatSupabaseError(error, { table: 'tech_earnings', clientLabel: 'DIAS ERP' }))
          setEarningsForm(emptyEarningsForm())
          setEarningsRecordId(null)
        } else {
          setEarningsMissing(false)
          setEarningsForm(earningsFromDb(data))
          setEarningsRecordId(data?.id || null)
        }
      } catch (err) {
        if (!cancelled) {
          setEarningsMissing(isMissingTableError(err))
          setEarningsError(formatSupabaseError(err, { table: 'tech_earnings', clientLabel: 'DIAS ERP' }))
          setEarningsForm(emptyEarningsForm())
          setEarningsRecordId(null)
        }
      } finally {
        if (!cancelled) {
          setEarningsDirty(false)
          setEarningsLoading(false)
        }
      }
    }

    loadEarnings()
    return () => {
      cancelled = true
    }
  }, [tech?.id])

  const loadAgreements = async () => {
    if (!tech?.id) {
      setAgreements([])
      return
    }
    setAgreementsLoading(true)
    setAgreementsError(null)
    try {
      const { data, error } = await diasClient
        .from('tech_agreements')
        .select('*')
        .eq('tech_id', String(tech.id))
        .eq('is_active', true)
        .order('type_code', { ascending: true })

      if (error) {
        setAgreementsMissing(isMissingTableError(error))
        setAgreementsError(
          formatSupabaseError(error, { table: 'tech_agreements', clientLabel: 'DIAS ERP' })
        )
        setAgreements([])
      } else {
        setAgreementsMissing(false)
        setAgreements(data || [])
      }
    } catch (err) {
      setAgreementsMissing(isMissingTableError(err))
      setAgreementsError(
        formatSupabaseError(err, { table: 'tech_agreements', clientLabel: 'DIAS ERP' })
      )
      setAgreements([])
    } finally {
      setAgreementsLoading(false)
    }
  }

  useEffect(() => {
    setAgreementForm(emptyAgreementForm())
    loadAgreements()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when tech changes
  }, [tech?.id])

  const loadPayments = async () => {
    if (!tech?.id) {
      setPayments([])
      return
    }
    setPaymentsLoading(true)
    setPaymentsError(null)
    try {
      const { data, error } = await diasClient
        .from('payment_entries')
        .select('*')
        .eq('tech_id', String(tech.id))
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) {
        setPaymentsMissing(isMissingTableError(error))
        setPaymentsError(
          formatSupabaseError(error, { table: 'payment_entries', clientLabel: 'DIAS ERP' })
        )
        setPayments([])
      } else {
        setPaymentsMissing(false)
        setPayments(data || [])
      }
    } catch (err) {
      setPaymentsMissing(isMissingTableError(err))
      setPaymentsError(
        formatSupabaseError(err, { table: 'payment_entries', clientLabel: 'DIAS ERP' })
      )
      setPayments([])
    } finally {
      setPaymentsLoading(false)
    }
  }

  useEffect(() => {
    setPaymentForm(emptyPaymentForm())
    loadPayments()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when tech changes
  }, [tech?.id])

  useEffect(() => {
    if (!tech?.id) {
      setLedgerRows([])
      return
    }

    let cancelled = false

    async function loadLedger() {
      setLedgerLoading(true)
      setLedgerError(null)
      const { from, to } = monthDateRange(analysisYear, selectedMonth)
      try {
        const { data, error } = await diasClient
          .from('tech_ledger_view')
          .select('*')
          .eq('tech_id', String(tech.id))
          .gte('entry_date', from)
          .lte('entry_date', to)
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false })

        if (cancelled) return

        if (error) {
          setLedgerMissing(isMissingTableError(error) || String(error.message || '').includes('tech_ledger'))
          setLedgerError(
            formatSupabaseError(error, { table: 'tech_ledger_view', clientLabel: 'DIAS ERP' })
          )
          setLedgerRows([])
        } else {
          setLedgerMissing(false)
          setLedgerRows(data || [])
        }
      } catch (err) {
        if (!cancelled) {
          setLedgerMissing(isMissingTableError(err))
          setLedgerError(
            formatSupabaseError(err, { table: 'tech_ledger_view', clientLabel: 'DIAS ERP' })
          )
          setLedgerRows([])
        }
      } finally {
        if (!cancelled) setLedgerLoading(false)
      }
    }

    loadLedger()
    return () => {
      cancelled = true
    }
  }, [tech?.id, analysisYear, selectedMonth, payments.length, ledgerTick])

  useEffect(() => {
    setSelectedLedgerRowKey(null)
  }, [tech?.id, analysisYear, selectedMonth])

  useEffect(() => {
    if (activeTab === 'analysis') return
    setMovementOpen(false)
    setSelectedRowData(null)
    setSelectedLedgerRowKey(null)
    setMovementPresetTypeId(null)
    setMovementPresetSide(null)
    setMovementPresetDescription(null)
    setMovementPresetAmount(null)
  }, [activeTab])

  const typeLookup = useMemo(() => buildTypeLookup(transactionTypes), [transactionTypes])

  const sortedTransactionTypes = useMemo(
    () => visibleTransactionTypes(transactionTypes),
    [transactionTypes]
  )

  const openMovementCreate = (preset = {}) => {
    setSelectedRowData(null)
    setSelectedLedgerRowKey(null)
    setMovementPresetTypeId(preset.typeId ?? null)
    setMovementPresetSide(preset.side ?? null)

    const ctx = { summary: selectedSummary, earningsForm }
    let presetDescription = preset.description ?? null
    let presetAmount = preset.amount ?? null

    if (preset.typeId != null) {
      const tt = typeLookup?.byId?.get(Number(preset.typeId))
      if (tt) {
        if (presetDescription == null) {
          presetDescription = buildLedgerDescriptionForType(tt, ctx) || null
        }
        if (presetAmount == null) {
          const amt = buildLedgerAmountForType(tt, ctx)
          presetAmount = amt > 0 ? amt : null
        }
      }
    }

    setMovementPresetDescription(presetDescription)
    setMovementPresetAmount(presetAmount)
    setMovementOpen(true)
  }

  const selectLedgerRow = (row) => {
    const key = ledgerRowKey(row)
    if (key) setSelectedLedgerRowKey(key)
  }

  const openMovementEdit = (row) => {
    selectLedgerRow(row)
    setSelectedRowData(row)
    setMovementPresetTypeId(null)
    setMovementPresetSide(null)
    setMovementPresetDescription(null)
    setMovementPresetAmount(null)
    setMovementOpen(true)
  }

  const openMovementViewSelected = () => {
    const row = ledgerDisplayRows.find((r) => ledgerRowKey(r) === selectedLedgerRowKey)
    if (!row) return
    if (row.__template && row.__type) {
      openMovementCreate({
        typeId: row.__type.id,
        side: resolveLedgerSide(row.__type, 0),
      })
      return
    }
    openMovementEdit(row)
  }

  const closeMovement = () => {
    setMovementOpen(false)
    setSelectedRowData(null)
    setMovementPresetTypeId(null)
    setMovementPresetSide(null)
    setMovementPresetDescription(null)
    setMovementPresetAmount(null)
  }

  const findTypeByDescription = (label) =>
    resolveTransactionType(typeLookup, { description: label, typeCode: label })

  const quickActionPresets = useMemo(
    () => [
      { label: 'Εξόφληση (1)', typeId: 91, side: 'CREDIT' },
      { label: 'Εξόφληση (2)', typeId: 92, side: 'CREDIT' },
      { label: 'Bonus', typeId: 4, side: 'DEBIT' },
      { label: 'Πληρωμή', tab: 'payments' },
    ],
    []
  )

  const handleMovementSaved = async ({ wasPayment } = {}) => {
    setLedgerTick((n) => n + 1)
    if (wasPayment) await loadPayments()
  }

  const handleMonthImport = async () => {
    if (!tech?.id || monthImportSaving) return
    setMonthImportSaving(true)
    setMonthImportMessage(null)
    setLedgerError(null)
    try {
      const result = await importMonthFromAgreements({
        tech,
        year: analysisYear,
        month: selectedMonth,
        earningsForm,
        agreements,
        transactionTypes,
        existingLedgerRows: ledgerRows,
      })
      setMonthImportMessage(result.message || null)
      setLedgerTick((n) => n + 1)
    } catch (err) {
      setLedgerError(err?.message || String(err))
    } finally {
      setMonthImportSaving(false)
    }
  }

  const ledgerBalances = useMemo(() => computeLedgerBalances(ledgerRows), [ledgerRows])

  const monthlyPayrolls = useMemo(() => {
    if (!tech) return []
    return Array.from({ length: 12 }, (_, i) =>
      buildMonthlyPayroll(tech, analysisYear, i + 1, assignments, jobs, dailyStatus)
    )
  }, [tech, analysisYear, assignments, jobs, dailyStatus])

  const estimatedByMonth = useMemo(
    () =>
      monthlyPayrolls.map((p) => ({
        amount: estimateAmount(tech, p.summary.workDays, p.summary.totalHours),
      })),
    [monthlyPayrolls, tech]
  )

  const salaryMatrix = useMemo(() => {
    if (!tech) {
      return {
        months: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          sigma: 0,
          pi: 0,
          y1: 0,
          y2: 0,
        })),
        totals: { sigma: 0, pi: 0, y1: 0, y2: 0 },
        avg: 0,
        selectedSettled: () => false,
        yearSettled: false,
      }
    }
    return buildSalaryYearMatrix(tech, analysisYear, payrolls, estimatedByMonth)
  }, [tech, analysisYear, payrolls, estimatedByMonth])

  const selectedPayroll = monthlyPayrolls[selectedMonth - 1]
  const movements = selectedPayroll?.rows || []
  const selectedSummary = selectedPayroll?.summary
  const selectedSalary = salaryMatrix.months[selectedMonth - 1]
  const monthSettled = salaryMatrix.selectedSettled?.(selectedMonth)

  const handleTransferHours = async () => {
    if (!tech?.id || hoursTransferSaving) return
    setHoursTransferSaving(true)
    setLedgerError(null)
    try {
      if (!tech._adminTech && !tech.admin_tech_id) {
        throw new Error('Ο υπάλληλος δεν έχει σύνδεση με Admin για ώρες βάρδιας.')
      }
      const result = await transferHoursToLedger({
        tech,
        year: analysisYear,
        month: selectedMonth,
        summary: selectedSummary,
        earningsForm,
        transactionTypes,
        existingLedgerRows: ledgerRows,
      })
      setMonthImportMessage(result.message || null)
      setLedgerTick((n) => n + 1)
    } catch (err) {
      setLedgerError(err?.message || String(err))
    } finally {
      setHoursTransferSaving(false)
    }
  }

  const ledgerMonthContext = useMemo(
    () => ({
      summary: selectedSummary || null,
      earningsForm,
      // Στήλη τιμολογίου από master personnel.payment_method === 'invoice'
      hasInvoice: personnelIssuesInvoice(tech),
    }),
    [selectedSummary, earningsForm, tech]
  )

  const ledgerDisplayRows = useMemo(
    () =>
      buildTemplateMergeRows({
        transactionTypes: sortedTransactionTypes,
        savedEntries: ledgerRows,
        typeLookup,
        monthContext: ledgerMonthContext,
      }),
    [sortedTransactionTypes, ledgerRows, typeLookup, ledgerMonthContext]
  )

  const filteredTechList = useMemo(() => {
    const list = Array.isArray(techList) ? techList : []
    const q = techSearch.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (t) =>
        String(t.name || '')
          .toLowerCase()
          .includes(q) || String(t.id ?? '').includes(q)
    )
  }, [techList, techSearch])

  if (!tech && !embedded) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-900/75 px-6 py-16 text-center text-slate-400">
        Επίλεξε τεχνικό για οικονομική ανάλυση.
      </div>
    )
  }

  const split = tech ? splitTechName(tech.displayName || tech.name) : { lastName: '', firstName: '' }
  const lastName = tech?.last_name || split.lastName
  const firstName = tech?.first_name || split.firstName
  const displayName = tech?.displayName || tech?.name || ''
  const photoUrl = tech ? techPhotoUrl(tech) : null
  const hireDate = tech ? techHireDate(tech) : null
  const hasAdminHours = Boolean(tech?._adminTech || tech?.admin_tech_id)
  const issuesInvoice = personnelIssuesInvoice(tech)

  const handleSave = () => {
    if (!tech) return
    const amount =
      selectedSalary?.sigma ||
      estimateAmount(tech, selectedSummary?.workDays ?? 0, selectedSummary?.totalHours ?? 0)
    onSaveToErp?.({
      tech_id: tech.id,
      tech_name: displayName || tech.name,
      days: selectedSummary?.workDays ?? 0,
      hours: selectedSummary?.totalHours ?? 0,
      overtime_hours: selectedSummary?.overtimeHours ?? 0,
      night_hours: selectedSummary?.nightHours ?? 0,
      holiday_hours: selectedSummary?.holidayHours ?? 0,
      weekend_bonus: selectedSummary?.weekendBonus ?? 0,
      metro_days: selectedSummary?.metroDays ?? 0,
      overnight_days: selectedSummary?.overnightDays ?? 0,
      repo_days: selectedSummary?.repoDays ?? 0,
      leave_days: selectedSummary?.leaveDays ?? 0,
      sick_days: selectedSummary?.sickDays ?? 0,
      amount,
      year: analysisYear,
      month: selectedMonth,
    })
  }

  const patchEarnings = (field, value) => {
    setEarningsForm((prev) => ({ ...prev, [field]: value }))
    setEarningsDirty(true)
  }

  const handleSaveEarnings = async () => {
    if (!tech || earningsMissing) return
    setEarningsSaving(true)
    setEarningsError(null)
    try {
      const payload = earningsToDb(earningsForm, tech)
      const query = earningsRecordId
        ? diasClient.from('tech_earnings').update(payload).eq('id', earningsRecordId).select('*').single()
        : diasClient.from('tech_earnings').upsert(payload, { onConflict: 'tech_id' }).select('*').single()

      const { data, error } = await query
      if (error) throw error
      setEarningsForm(earningsFromDb(data))
      setEarningsRecordId(data?.id || null)
      setEarningsDirty(false)
    } catch (err) {
      setEarningsMissing(isMissingTableError(err))
      setEarningsError(formatSupabaseError(err, { table: 'tech_earnings', clientLabel: 'DIAS ERP' }))
    } finally {
      setEarningsSaving(false)
    }
  }

  const handleResetEarnings = () => {
    setEarningsForm(emptyEarningsForm())
    setEarningsDirty(true)
  }

  const handleDeleteEarnings = async () => {
    if (!tech || !earningsRecordId) {
      handleResetEarnings()
      return
    }
    if (!window.confirm(`Διαγραφή αποδοχών για ${tech.name};`)) return
    setEarningsSaving(true)
    setEarningsError(null)
    try {
      const { error } = await diasClient.from('tech_earnings').delete().eq('id', earningsRecordId)
      if (error) throw error
      setEarningsForm(emptyEarningsForm())
      setEarningsRecordId(null)
      setEarningsDirty(false)
    } catch (err) {
      setEarningsError(formatSupabaseError(err, { table: 'tech_earnings', clientLabel: 'DIAS ERP' }))
    } finally {
      setEarningsSaving(false)
    }
  }

  const earningsSum = earningsTotal(earningsForm)

  const patchAgreement = (field, value) => {
    setAgreementForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSaveAgreement = async (e) => {
    e?.preventDefault?.()
    if (!tech?.id || agreementsMissing) return
    setAgreementsSaving(true)
    setAgreementsError(null)
    try {
      const args = agreementRpcArgs(agreementForm, tech.id)
      const { data, error } = await diasClient.rpc('add_tech_agreement', args)
      if (error) throw error
      void data
      setAgreementForm((prev) => ({
        ...emptyAgreementForm(),
        type_code: prev.type_code,
        valid_from: new Date().toISOString().slice(0, 10),
      }))
      await loadAgreements()
    } catch (err) {
      const msg = String(err?.message || err || '')
      if (msg.includes('add_tech_agreement') || msg.includes('function') || isMissingTableError(err)) {
        setAgreementsMissing(true)
        setAgreementsError(
          'Λείπει πίνακας/RPC tech_agreements. Τρέξε supabase/03_tech_agreements.sql στο DIAS.'
        )
      } else if (msg.includes('foreign key') || msg.includes('personnel')) {
        setAgreementsError(
          'Ο υπάλληλος πρέπει να υπάρχει στο DIAS personnel (tech_id). Αποθήκευσε/εισήγαγε πρώτα το προσωπικό.'
        )
      } else {
        setAgreementsError(
          formatSupabaseError(err, { table: 'tech_agreements', clientLabel: 'DIAS ERP' }) || msg
        )
      }
    } finally {
      setAgreementsSaving(false)
    }
  }

  const patchPayment = (field, value) => {
    setPaymentForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSavePayment = async (e) => {
    e?.preventDefault?.()
    if (!tech?.id || paymentsMissing) return
    setPaymentsSaving(true)
    setPaymentsError(null)
    try {
      const payload = paymentToDb(paymentForm, tech)
      const { error } = await diasClient.from('payment_entries').insert(payload)
      if (error) throw error
      setPaymentForm(emptyPaymentForm())
      await loadPayments()
      setLedgerTick((n) => n + 1)
    } catch (err) {
      const msg = String(err?.message || err || '')
      if (isMissingTableError(err) || msg.includes('payment_date') || msg.includes('payment_type')) {
        setPaymentsMissing(true)
        setPaymentsError(
          'Λείπουν στήλες payment_entries. Τρέξε supabase/04_payment_entries.sql στο DIAS.'
        )
      } else if (msg.includes('foreign key') || msg.includes('personnel')) {
        setPaymentsError(
          'Ο υπάλληλος πρέπει να υπάρχει στο DIAS personnel (tech_id).'
        )
      } else {
        setPaymentsError(
          formatSupabaseError(err, { table: 'payment_entries', clientLabel: 'DIAS ERP' }) || msg
        )
      }
    } finally {
      setPaymentsSaving(false)
    }
  }

  const showMatrix = activeTab === 'analysis'
  const showMovements = activeTab === 'movements'
  const showTechDropdown = !embedded && Array.isArray(techList) && techList.length > 0 && onTechChange
  const innerTabs = [
    { id: 'analysis', label: 'Οικονομική Ανάλυση' },
    { id: 'earnings', label: 'Αποδοχές' },
    { id: 'agreements', label: 'Συμφωνίες (Agreements)' },
    { id: 'payments', label: 'Πληρωμές (Payments)' },
    { id: 'movements', label: 'Αναλυτικά στοιχεία' },
  ]

  const usePersonnelSidebar = embedded && typeof onPersonSelect === 'function'

  const techSidebar = usePersonnelSidebar ? (
    <PersonnelPanel
      variant="sidebar"
      personnel={personnel}
      selectedId={selectedPersonId}
      onSelect={onPersonSelect}
    />
  ) : embedded && onTechChange ? (
    <aside className="flex max-h-56 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md md:max-h-none md:w-72 md:self-stretch lg:w-80">
      <div className="border-b border-white/10 px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
          Προσωπικό
        </p>
        <p className="mt-0.5 text-sm font-semibold text-white">Επιλογή τεχνικού</p>
        <input
          type="search"
          value={techSearch}
          onChange={(e) => setTechSearch(e.target.value)}
          placeholder="Αναζήτηση..."
          className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filteredTechList.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-500">Κανένα αποτέλεσμα</p>
        ) : (
          filteredTechList.map((t) => {
            const selected = tech?.id === t.id
            const parts = splitTechName(t.name)
            const initials = (t.initials || parts.lastName.slice(0, 2) || '?').toUpperCase()
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTechChange(t)}
                className={`mb-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                  selected
                    ? 'border border-cyan-500/40 bg-cyan-500/15 text-cyan-100'
                    : 'border border-transparent text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    selected ? 'bg-cyan-500/25 text-cyan-100' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{t.name}</span>
                  <span className="block text-[10px] text-slate-500">#{t.id}</span>
                </span>
              </button>
            )
          })
        )}
      </div>
      <div className="border-t border-white/10 px-3 py-2 text-[10px] text-slate-500">
        {filteredTechList.length} / {(techList || []).length} τεχνικοί
      </div>
    </aside>
  ) : null

  const mainPanel = !tech ? (
    <div className="flex flex-1 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/75 px-6 py-16 text-center text-slate-400">
      {usePersonnelSidebar
        ? 'Επίλεξε ενεργό μόνιμο υπάλληλο από τη λίστα αριστερά.'
        : 'Επίλεξε τεχνικό από τη λίστα αριστερά.'}
    </div>
  ) : (
    <div className={`relative flex min-w-0 flex-1 flex-col ${embedded ? 'space-y-4' : 'flex-1 overflow-hidden'}`}>
      {!embedded && (
        <div className="relative flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400/80">
              DIAS ERP · Legacy Bridge
            </p>
            <h2 className="bg-gradient-to-r from-white to-cyan-200 bg-clip-text text-xl font-bold text-transparent">
              Οικονομικά Στοιχεία Προσωπικού
            </h2>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-rose-500/40 bg-rose-500/20 px-3 py-1.5 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/30"
            >
              Έξοδος
            </button>
          )}
        </div>
      )}

      <div className={`relative space-y-3 ${embedded ? '' : 'flex-1 overflow-y-auto p-4 sm:p-5'}`}>
        {/* Κεφαλίδα όπως παλιό ERP: μήνας/έτος · στοιχεία · φωτογραφία */}
        {tech && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-3 shadow-xl backdrop-blur-md sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="analysis-month" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Μήνας
                </label>
                <select
                  id="analysis-month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm font-medium text-white"
                >
                  {MONTH_LABELS.map((label, i) => (
                    <option key={label} value={i + 1}>
                      {String(i + 1).padStart(2, '0')}. {label.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="analysis-year" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Έτος
                </label>
                <input
                  id="analysis-year"
                  type="number"
                  min={2020}
                  max={2035}
                  value={analysisYear}
                  onChange={(e) => setAnalysisYear(Number(e.target.value) || initialYear)}
                  className="w-24 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm font-medium text-white"
                />
              </div>
              {showTechDropdown && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="analysis-tech" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Τεχνικός
                  </label>
                  <select
                    id="analysis-tech"
                    value={tech.id}
                    onChange={(e) => {
                      const next = techList.find((t) => String(t.id) === e.target.value)
                      if (next) onTechChange(next)
                    }}
                    className="min-w-[180px] rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm font-medium text-white"
                  >
                    {techList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              <InfoField label="Κωδικός" value={tech.code || tech.id} />
              <InfoField label="Επώνυμο" value={lastName} />
              <InfoField label="Όνομα" value={firstName} />
              <InfoField label="Πρόσληψη" value={hireDate || '—'} />
            </div>

            <div className="flex flex-col items-center gap-2 lg:items-end">
              <div className="flex flex-wrap justify-end gap-1">
                {tech.employment_type && (
                  <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                    {employmentLabel(tech.employment_type)}
                  </span>
                )}
                {!hasAdminHours && (
                  <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                    Χωρίς ώρες Admin
                  </span>
                )}
              </div>
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-slate-800">
                {photoUrl ? (
                  <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-cyan-300/80">
                    {(tech.initials || lastName.slice(0, 2)).toUpperCase()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Tabs παλιού ERP — δεξιά από τη στήλη ονομάτων */}
        <div className="flex gap-1 overflow-x-auto border-b border-white/10 pb-px">
          {innerTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 rounded-t-xl px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab.id
                  ? 'border border-b-0 border-white/10 bg-slate-900/90 text-cyan-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loadError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            Σφάλμα φόρτωσης: {loadError}
          </div>
        )}

        {showMatrix && (
          <>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl backdrop-blur-md">
              <div className="border-b border-white/10 px-4 py-3">
                <h3 className="text-sm font-semibold text-white">
                  Ετήσια Μήτρα Απολαβών · {analysisYear}
                </h3>
                <p className="text-xs text-slate-400">
                  Σ = απολαβές · Π = πληρωμές · Υ(1)/Υ(2) = εξοφλήσεις — από DIAS payrolls (ή provisional από
                  ώρες)
                </p>
              </div>
              {loading ? (
                <div className="px-4 py-10 text-center text-slate-400">Υπολογισμός μήτρας...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="sticky left-0 z-10 bg-slate-950/95 px-3 py-2 font-semibold"> </th>
                        {MONTH_LABELS.map((label, i) => (
                          <th
                            key={label}
                            className={`cursor-pointer px-1.5 py-2 text-center font-semibold transition hover:text-cyan-200 ${
                              selectedMonth === i + 1 ? 'bg-amber-400/90 text-slate-950' : ''
                            }`}
                            onClick={() => setSelectedMonth(i + 1)}
                            title={label}
                          >
                            {MONTH_SHORT[i]}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-right font-semibold text-cyan-300/90">Σύνολο</th>
                      </tr>
                    </thead>
                    <tbody>
                      <MatrixRow
                        label="Σ"
                        hint="Απολαβές"
                        selectedMonth={selectedMonth}
                        onSelectMonth={setSelectedMonth}
                        values={salaryMatrix.months.map((m) => formatEuroPlain(m.sigma))}
                        total={formatEuroPlain(salaryMatrix.totals.sigma)}
                      />
                      <MatrixRow
                        label="Π"
                        hint="Πληρωμές"
                        selectedMonth={selectedMonth}
                        onSelectMonth={setSelectedMonth}
                        values={salaryMatrix.months.map((m) => formatEuroPlain(m.pi))}
                        total={formatEuroPlain(salaryMatrix.totals.pi)}
                      />
                      <MatrixRow
                        label="Υ (1)"
                        hint="Εξόφληση 1"
                        selectedMonth={selectedMonth}
                        onSelectMonth={setSelectedMonth}
                        values={salaryMatrix.months.map((m) => formatEuroPlain(m.y1))}
                        total={formatEuroPlain(salaryMatrix.totals.y1)}
                      />
                      <MatrixRow
                        label="Υ (2)"
                        hint="Εξόφληση 2"
                        selectedMonth={selectedMonth}
                        onSelectMonth={setSelectedMonth}
                        values={salaryMatrix.months.map((m) => formatEuroPlain(m.y2))}
                        total={formatEuroPlain(salaryMatrix.totals.y2)}
                      />
                      <MatrixRow
                        label="Ticket Restaurant"
                        hint=""
                        selectedMonth={selectedMonth}
                        onSelectMonth={setSelectedMonth}
                        values={Array.from({ length: 12 }, () => '-')}
                        total="-"
                      />
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/75 px-4 py-3 backdrop-blur-md">
              <SummaryStat label="Συνολικές Απολαβές" value={formatEuro(salaryMatrix.totals.sigma)} />
              <SummaryStat label="Έτος" value={formatEuro(salaryMatrix.totals.sigma)} />
              <SummaryStat label="Μ. Όρος" value={formatEuro(salaryMatrix.avg)} />
              <SummaryStat
                label={MONTH_LABELS[selectedMonth - 1]}
                value={formatEuro(selectedSalary?.sigma || 0)}
              />
              <div className="ml-auto">
                <span
                  className={`rounded-lg px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                    monthSettled
                      ? 'bg-rose-500/20 text-rose-300'
                      : (selectedSalary?.sigma || 0) > 0
                        ? 'bg-amber-500/20 text-amber-200'
                        : 'bg-slate-500/20 text-slate-400'
                  }`}
                >
                  {monthSettled
                    ? 'Εξοφληθεί'
                    : (selectedSalary?.sigma || 0) > 0
                      ? 'Ανοιχτό'
                      : 'Χωρίς δεδομένα'}
                </span>
              </div>
            </div>

            {/* Μηνιαία Ανάλυση — unified ledger (payroll_entries ∪ payment_entries) */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
              <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl backdrop-blur-md">
                {ledgerMissing && (
                  <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
                    Λείπει το <code className="rounded bg-black/30 px-1">tech_ledger_view</code>. Τρέξε{' '}
                    <code className="rounded bg-black/30 px-1">supabase/05_payroll_entries_and_ledger.sql</code>.
                  </div>
                )}
                {transactionTypesError && (
                  <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
                    {transactionTypesError}
                  </div>
                )}
                {ledgerError && !ledgerMissing && (
                  <div className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
                    {ledgerError}
                  </div>
                )}
                <LedgerAnalysisGrid
                  rows={ledgerDisplayRows}
                  loading={ledgerLoading}
                  skeletonCount={8}
                  selectedRowKey={selectedLedgerRowKey}
                  typeLookup={typeLookup}
                  monthContext={ledgerMonthContext}
                  hasInvoice={ledgerMonthContext.hasInvoice}
                  onSelectRow={selectLedgerRow}
                  onOpenCreateForType={openMovementCreate}
                  onOpenEditRow={openMovementEdit}
                />

                <div className="flex flex-wrap gap-3 border-t border-white/10 bg-slate-950/50 px-3 py-2.5">
                  <BalanceChip label="Υπόλοιπο" value={formatEuro(ledgerBalances.balance)} />
                  <BalanceChip label="Υπόλοιπο (1)" value={formatEuro(ledgerBalances.balance1)} />
                  <BalanceChip label="Υπόλοιπο (2)" value={formatEuro(ledgerBalances.balance2)} />
                  <BalanceChip label="Έξτρα" value={formatEuro(0)} />
                  <BalanceChip label="Τιμολόγιο" value={formatEuro(ledgerBalances.invoice || 0)} />
                </div>
              </div>

              <aside className="flex shrink-0 flex-row gap-2 overflow-x-auto lg:w-36 lg:flex-col lg:overflow-visible">
                <button
                  type="button"
                  onClick={handleMonthImport}
                  disabled={monthImportSaving || ledgerLoading || !tech}
                  title="Υπολογισμός μήνα από Αποδοχές / Συμφωνίες (Μισθός, Bonus, Λογιστής)"
                  className="shrink-0 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-2.5 text-left text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40 lg:w-full"
                >
                  {monthImportSaving ? 'ΔΗΜΙΟΥΡΓΙΑ...' : 'ΔΗΜΙΟΥΡΓΙΑ'}
                </button>
                {monthImportMessage ? (
                  <p className="hidden text-[10px] leading-snug text-cyan-200/80 lg:block">
                    {monthImportMessage}
                  </p>
                ) : null}
                {[
                  {
                    label: 'Εμφάνιση',
                    action: openMovementViewSelected,
                    disabled: !selectedLedgerRowKey,
                  },
                  { label: 'Διαγραφή', action: () => alert('Διαγραφή — σύντομα') },
                  ...quickActionPresets,
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={item.disabled}
                    onClick={() => {
                      if (item.tab === 'payments') setActiveTab('payments')
                      else if (item.action) item.action()
                      else if (item.typeId) openMovementCreate({ typeId: item.typeId, side: item.side })
                      else {
                        const tt = findTypeByDescription(item.label)
                        openMovementCreate({
                          typeId: tt?.id ?? item.typeId,
                          side: item.side || 'DEBIT',
                        })
                      }
                    }}
                    className="shrink-0 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-left text-xs font-semibold text-slate-200 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40 lg:w-full"
                  >
                    {item.label}
                  </button>
                ))}
              </aside>
            </div>

            <MovementModal
              key={
                selectedRowData
                  ? `${selectedRowData.source}-${selectedRowData.id}`
                  : `new-${movementPresetTypeId || 'blank'}`
              }
              open={movementOpen}
              selectedRowData={selectedRowData}
              tech={tech}
              presetTypeId={movementPresetTypeId}
              presetSide={movementPresetSide}
              presetDescription={movementPresetDescription}
              presetAmount={movementPresetAmount}
              hasInvoice={ledgerMonthContext.hasInvoice}
              onClose={closeMovement}
              onSaved={handleMovementSaved}
            />
          </>
        )}

        {activeTab === 'earnings' && (
          <div className="space-y-3">
            {earningsMissing && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Λείπει ο πίνακας <code className="rounded bg-black/30 px-1">tech_earnings</code> στο DIAS
                Supabase. Τρέξε το SQL από{' '}
                <code className="rounded bg-black/30 px-1">supabase/tech_earnings.sql</code> στο SQL Editor.
              </div>
            )}
            {earningsError && !earningsMissing && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {earningsError}
              </div>
            )}

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md">
                {earningsLoading ? (
                  <div className="px-4 py-12 text-center text-slate-400">Φόρτωση αποδοχών...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400">
                          <th className="px-4 py-2.5 font-semibold">Τύπος</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Ποσό</th>
                          <th className="px-3 py-2.5 text-right font-semibold">&gt; από</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Ελάχιστο</th>
                        </tr>
                      </thead>
                      <tbody>
                        {EARNINGS_ROW_DEFS.map((def, idx) => (
                          <tr
                            key={def.key}
                            className={`border-b border-white/5 ${idx % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                          >
                            <td className="px-4 py-1.5 font-medium text-white">{def.label}</td>
                            {['amount', 'from', 'min'].map((suffix) => {
                              const field = `${def.key}_${suffix}`
                              return (
                                <td key={field} className="px-2 py-1">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={earningsForm[field] ?? ''}
                                    onChange={(e) => patchEarnings(field, e.target.value)}
                                    disabled={earningsMissing}
                                    className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-right font-mono text-sm text-white disabled:opacity-50"
                                  />
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-white/10 bg-slate-950/70">
                          <td className="px-4 py-2.5 text-sm font-bold text-cyan-200">Σύνολο</td>
                          <td className="px-3 py-2.5 text-right font-mono text-sm font-bold text-white">
                            {formatEuroPlain(earningsSum) || '0,00'}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                <p className="border-t border-white/5 px-4 py-2 text-[11px] text-slate-500">
                  Αποδοχές ανά υπάλληλο στο DIAS · {earningsDirty ? 'μη αποθηκευμένες αλλαγές' : 'αποθηκευμένο'}
                </p>
              </div>

              <div className="flex shrink-0 flex-row gap-2 lg:w-36 lg:flex-col">
                <button
                  type="button"
                  onClick={handleResetEarnings}
                  disabled={earningsMissing || earningsSaving}
                  className="shrink-0 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-left text-xs font-semibold text-slate-200 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 disabled:opacity-50 lg:w-full"
                >
                  Εισαγωγή
                </button>
                <button
                  type="button"
                  onClick={handleSaveEarnings}
                  disabled={earningsMissing || earningsSaving || earningsLoading}
                  className="shrink-0 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2.5 text-left text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-50 lg:w-full"
                >
                  {earningsSaving ? 'Αποθήκευση...' : 'Αποθήκευση'}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteEarnings}
                  disabled={earningsMissing || earningsSaving}
                  className="shrink-0 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2.5 text-left text-xs font-semibold text-rose-100 transition hover:bg-rose-500/25 disabled:opacity-50 lg:w-full"
                >
                  Διαγραφή
                </button>
              </div>

              <div className="flex w-full shrink-0 flex-col gap-3 lg:w-72">
                <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 shadow-xl backdrop-blur-md">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
                    Στοιχεία
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor="earnings-iban"
                        className="text-[10px] font-semibold uppercase tracking-wider text-slate-400"
                      >
                        Αρ. Λογαριασμού
                      </label>
                      <input
                        id="earnings-iban"
                        type="text"
                        value={tech?.iban || ''}
                        readOnly
                        disabled
                        placeholder="από καρτέλα υπαλλήλου"
                        title="Επεξεργασία μόνο από την καρτέλα Υπάλληλοι"
                        className="mt-1 w-full cursor-not-allowed rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 font-mono text-sm text-slate-300 placeholder:text-slate-600 opacity-80"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="earnings-bank"
                        className="text-[10px] font-semibold uppercase tracking-wider text-slate-400"
                      >
                        Τράπεζα
                      </label>
                      <input
                        id="earnings-bank"
                        type="text"
                        value={tech?.bank_name || ''}
                        readOnly
                        disabled
                        placeholder="από καρτέλα υπαλλήλου"
                        title="Επεξεργασία μόνο από την καρτέλα Υπάλληλοι"
                        className="mt-1 w-full cursor-not-allowed rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600 opacity-80"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 shadow-xl backdrop-blur-md">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
                    Παραστατικό
                  </p>
                  <p
                    title="Ορίζεται από Πληρωμή / παραστατικό στην καρτέλα υπαλλήλου"
                    className={
                      issuesInvoice
                        ? 'text-sm font-medium text-cyan-200/90'
                        : 'text-sm font-medium text-slate-400'
                    }
                  >
                    {issuesInvoice ? 'Με τιμολόγιο' : 'Χωρίς τιμολόγιο'}
                  </p>
                  {issuesInvoice ? (
                    <div className="mt-3 flex items-center gap-2">
                      <label
                        htmlFor="earnings-extra"
                        className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400"
                      >
                        Έξτρα
                      </label>
                      <input
                        id="earnings-extra"
                        type="text"
                        value={earningsForm.extra}
                        onChange={(e) => patchEarnings('extra', e.target.value)}
                        disabled={earningsMissing}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white disabled:opacity-50"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'agreements' && (
          <div className="space-y-3">
            {agreementsMissing && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Λείπει ο πίνακας / RPC <code className="rounded bg-black/30 px-1">tech_agreements</code>.
                Τρέξε το SQL από{' '}
                <code className="rounded bg-black/30 px-1">supabase/03_tech_agreements.sql</code> στο DIAS
                SQL Editor.
              </div>
            )}
            {agreementsError && !agreementsMissing && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {agreementsError}
              </div>
            )}

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md">
                <div className="border-b border-white/10 px-4 py-3">
                  <h3 className="text-sm font-semibold text-white">Ενεργές συμφωνίες</h3>
                  <p className="text-xs text-slate-400">
                    Mirror APG EMPLOEE_MISTO — μόνο <code className="text-slate-300">is_active = true</code>. Νέα
                    τιμή ίδιου τύπου απενεργοποιεί την παλιά (ιστορικό).
                  </p>
                </div>
                {agreementsLoading ? (
                  <div className="px-4 py-12 text-center text-slate-400">Φόρτωση συμφωνιών...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400">
                          <th className="px-4 py-2.5 font-semibold">Τύπος</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Ποσό</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Από (up_from)</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Ελάχιστο</th>
                          <th className="px-3 py-2.5 font-semibold">Ισχύει από</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agreements.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                              Καμία ενεργή συμφωνία — πρόσθεσε από τη φόρμα δεξιά.
                            </td>
                          </tr>
                        ) : (
                          agreements.map((row) => (
                            <tr
                              key={row.id}
                              className="border-b border-white/5 hover:bg-slate-800/40"
                            >
                              <td className="px-4 py-2.5 font-medium text-white">
                                {agreementTypeLabel(row.type_code)}
                                <span className="mt-0.5 block font-mono text-[10px] text-slate-500">
                                  {row.type_code}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-cyan-100">
                                {formatAgreementAmount(row.amount)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                                {row.up_from != null ? row.up_from : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                                {row.minimum != null ? row.minimum : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-slate-300">
                                {row.valid_from
                                  ? new Date(row.valid_from).toLocaleDateString('el-GR')
                                  : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <form
                onSubmit={handleSaveAgreement}
                className="w-full shrink-0 space-y-3 rounded-2xl border border-white/10 bg-slate-900/75 p-4 shadow-xl backdrop-blur-md lg:w-80"
              >
                <h3 className="text-sm font-semibold text-white">Νέα συμφωνία</h3>
                <p className="text-[11px] text-slate-400">
                  Αποθήκευση μέσω RPC <code className="text-slate-300">add_tech_agreement</code>
                </p>

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Τύπος αμοιβής
                  </label>
                  <select
                    value={agreementForm.type_code}
                    onChange={(e) => patchAgreement('type_code', e.target.value)}
                    disabled={agreementsMissing || agreementsSaving}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {AGREEMENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Ποσό (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={agreementForm.amount}
                    onChange={(e) => patchAgreement('amount', e.target.value)}
                    disabled={agreementsMissing || agreementsSaving}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white disabled:opacity-50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Από (up_from)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={agreementForm.up_from}
                      onChange={(e) => patchAgreement('up_from', e.target.value)}
                      disabled={agreementsMissing || agreementsSaving}
                      placeholder="π.χ. 8"
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Ελάχιστο
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={agreementForm.minimum}
                      onChange={(e) => patchAgreement('minimum', e.target.value)}
                      disabled={agreementsMissing || agreementsSaving}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white disabled:opacity-50"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Ισχύει από
                  </label>
                  <input
                    type="date"
                    value={agreementForm.valid_from}
                    onChange={(e) => patchAgreement('valid_from', e.target.value)}
                    disabled={agreementsMissing || agreementsSaving}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white disabled:opacity-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={agreementsMissing || agreementsSaving || !tech}
                  className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2.5 text-sm font-bold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  {agreementsSaving ? 'Αποθήκευση...' : 'Αποθήκευση συμφωνίας'}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="space-y-3">
            {paymentsMissing && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Λείπουν στήλες / πίνακας <code className="rounded bg-black/30 px-1">payment_entries</code>.
                Τρέξε το SQL από{' '}
                <code className="rounded bg-black/30 px-1">supabase/04_payment_entries.sql</code> στο DIAS.
              </div>
            )}
            {paymentsError && !paymentsMissing && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {paymentsError}
              </div>
            )}

            <form
              onSubmit={handleSavePayment}
              className="grid gap-3 rounded-2xl border border-white/10 bg-slate-900/75 p-4 shadow-xl backdrop-blur-md sm:grid-cols-2 lg:grid-cols-5"
            >
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Ημερομηνία
                </label>
                <input
                  type="date"
                  value={paymentForm.payment_date}
                  onChange={(e) => patchPayment('payment_date', e.target.value)}
                  disabled={paymentsMissing || paymentsSaving}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white disabled:opacity-50"
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
                  value={paymentForm.amount}
                  onChange={(e) => patchPayment('amount', e.target.value)}
                  disabled={paymentsMissing || paymentsSaving}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Τύπος πληρωμής
                </label>
                <select
                  value={paymentForm.payment_type}
                  onChange={(e) => patchPayment('payment_type', e.target.value)}
                  disabled={paymentsMissing || paymentsSaving}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {PAYMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Αιτιολογία / σχόλια
                </label>
                <input
                  type="text"
                  value={paymentForm.notes}
                  onChange={(e) => patchPayment('notes', e.target.value)}
                  disabled={paymentsMissing || paymentsSaving}
                  placeholder="προαιρετικό"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-600 disabled:opacity-50"
                />
              </div>
              <div className="flex items-end sm:col-span-2 lg:col-span-1">
                <button
                  type="submit"
                  disabled={paymentsMissing || paymentsSaving || !tech}
                  className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2.5 text-sm font-bold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  {paymentsSaving ? 'Αποθήκευση...' : 'Καταχώρηση'}
                </button>
              </div>
            </form>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md">
              <div className="border-b border-white/10 px-4 py-3">
                <h3 className="text-sm font-semibold text-white">Ιστορικό πληρωμών</h3>
                <p className="text-xs text-slate-400">Νεότερες πρώτα · πίνακας payment_entries</p>
              </div>
              {paymentsLoading ? (
                <div className="px-4 py-12 text-center text-slate-400">Φόρτωση πληρωμών...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-2.5 font-semibold">Ημερομηνία</th>
                        <th className="px-3 py-2.5 font-semibold">Τύπος</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Ποσό</th>
                        <th className="px-3 py-2.5 font-semibold">Αιτιολογία</th>
                        <th className="px-3 py-2.5 font-semibold">Καταχώρηση</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                            Δεν υπάρχουν πληρωμές ακόμα.
                          </td>
                        </tr>
                      ) : (
                        payments.map((row) => (
                          <tr
                            key={row.id}
                            className="border-b border-white/5 hover:bg-slate-800/40"
                          >
                            <td className="px-4 py-2.5 text-slate-200">
                              {row.payment_date
                                ? new Date(row.payment_date).toLocaleDateString('el-GR')
                                : '—'}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-semibold text-slate-200">
                                {paymentTypeLabel(row.payment_type || row.entry_type)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold text-cyan-100">
                              {formatPaymentAmount(row.amount)}
                            </td>
                            <td className="max-w-[280px] truncate px-3 py-2.5 text-slate-400">
                              {row.notes || row.description || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-500">
                              {row.created_at
                                ? new Date(row.created_at).toLocaleString('el-GR')
                                : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {showMovements && (
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl backdrop-blur-md">
                <div className="border-b border-white/10 px-4 py-3">
                  <h3 className="text-sm font-semibold text-white">
                    Αναλυτικές Κινήσεις · {MONTH_LABELS[selectedMonth - 1]} {analysisYear}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Ημερήσια λίστα για {tech.name}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-950/60 text-xs uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-3 font-semibold">Ημερομηνία</th>
                        <th className="px-4 py-3 font-semibold">Έργο / Κατάσταση</th>
                        <th className="px-4 py-3 font-semibold">Φάση</th>
                        <th className="px-4 py-3 font-semibold">Ώρες</th>
                        <th className="px-4 py-3 text-right font-semibold">Σύνολο</th>
                        <th className="px-4 py-3 text-right font-semibold">Υπερ.</th>
                        <th className="px-4 py-3 text-right font-semibold">Νυχτ.</th>
                        <th className="px-4 py-3 text-right font-semibold">Αργίες</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                            Φόρτωση κινήσεων...
                          </td>
                        </tr>
                      ) : movements.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                            Δεν βρέθηκαν κινήσεις για τον επιλεγμένο μήνα.
                          </td>
                        </tr>
                      ) : (
                        movements.map((row, idx) => (
                          <tr
                            key={`${row.dateIso}-${row.jobOrStatus}-${row.timeStart}-${idx}`}
                            className="border-b border-white/5 transition hover:bg-white/5"
                          >
                            <td className="px-4 py-2.5 font-mono text-xs text-cyan-100/90">{row.dateIso}</td>
                            <td className="max-w-[240px] truncate px-4 py-2.5 text-white">{row.jobOrStatus}</td>
                            <td className="px-4 py-2.5 text-slate-400">{row.phase}</td>
                            <td className="px-4 py-2.5 text-slate-300">
                              {row.timeStart && row.timeEnd && row.timeStart !== '-'
                                ? `${row.timeStart} – ${row.timeEnd}`
                                : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right text-slate-200">{row.workedHours || '—'}</td>
                            <td className="px-4 py-2.5 text-right text-amber-200/90">{row.overtime || '—'}</td>
                            <td className="px-4 py-2.5 text-right text-violet-200/90">{row.nightHours || '—'}</td>
                            <td className="px-4 py-2.5 text-right text-emerald-200/90">
                              {row.weekendHolidayHours || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
        )}
      </div>

      <div className="relative flex flex-wrap items-center gap-2 border-t border-white/10 bg-slate-950/70 px-4 py-3 backdrop-blur-md">
        <ActionButton
          tone="slate"
          disabled={hoursTransferSaving || loading || !tech}
          onClick={handleTransferHours}
        >
          {hoursTransferSaving ? 'Μεταφορά...' : 'Μεταφορά Ωρών'}
        </ActionButton>
        <ActionButton tone="slate" onClick={() => alert('Εκτύπωση — σύντομα')}>
          Εκτύπωση
        </ActionButton>
        <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />
        <ActionButton tone="emerald" disabled={saving || loading} onClick={handleSave}>
          {saving ? 'Αποθήκευση...' : 'Οριστική Αποθήκευση ERP'}
        </ActionButton>
        {(onClose || embedded) && (
          <button
            type="button"
            onClick={() => {
              if (onClose) onClose()
              else alert('Έξοδος — κλείσε από τη γραμμή τίτλου του παραθύρου')
            }}
            className="ml-auto inline-flex items-center rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-sm font-bold text-rose-100 transition hover:bg-rose-500/25 active:scale-95"
          >
            Έξοδος
          </button>
        )}
      </div>
    </div>
  )

  const content = embedded ? (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden md:flex-row md:items-stretch">
      {techSidebar}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{mainPanel}</div>
    </div>
  ) : (
    mainPanel
  )

  if (embedded) return content

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Κλείσιμο"
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="relative flex max-h-[94vh] w-full max-w-[1920px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 shadow-2xl">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          aria-hidden
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(34,211,238,0.15), transparent 40%), radial-gradient(circle at 80% 70%, rgba(99,102,241,0.2), transparent 45%)',
          }}
        />
        {content}
      </div>
    </div>
  )
}

function InfoField({ label, value }) {
  return (
    <div className="rounded-xl border border-white/5 bg-slate-950/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  )
}

function SummaryStat({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-lg font-bold text-white">{value}</p>
    </div>
  )
}

function BalanceChip({ label, value }) {
  return (
    <div className="rounded-lg border border-white/5 bg-slate-900/60 px-2.5 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="font-mono text-xs font-semibold text-slate-200">{value}</p>
    </div>
  )
}

function MatrixRow({ label, hint, values, total, selectedMonth, onSelectMonth }) {
  return (
    <tr className="border-b border-white/5">
      <td className="sticky left-0 bg-slate-900/95 px-3 py-2 font-bold text-cyan-200">
        <span title={hint}>{label}</span>
        <span className="ml-1 text-[10px] font-normal text-slate-500">{hint}</span>
      </td>
      {values.map((value, i) => (
        <td
          key={`${label}-${i}`}
          onClick={() => onSelectMonth(i + 1)}
          className={`cursor-pointer px-2 py-2 text-center font-mono text-[11px] transition hover:bg-white/5 ${
            selectedMonth === i + 1 ? 'bg-amber-400/25 font-semibold text-amber-100' : 'text-slate-300'
          }`}
        >
          {value || '·'}
        </td>
      ))}
      <td className="px-3 py-2 text-right font-semibold text-cyan-200">{total}</td>
    </tr>
  )
}

function ActionButton({ tone, children, disabled, onClick }) {
  const tones = {
    slate: 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10',
    violet:
      'border-violet-500/40 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30 shadow-violet-500/15',
    rose: 'border-rose-500/40 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30',
    emerald:
      'border-emerald-500/40 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30 shadow-emerald-500/20',
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center rounded-xl border px-4 py-2 text-sm font-bold shadow-lg transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  )
}
