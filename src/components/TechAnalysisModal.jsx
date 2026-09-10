import React, { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { adminClient, diasClient, safeQuery, isMissingTableError, formatSupabaseError } from '../lib/supabase'
import {
  buildMonthlyPayroll,
  globalCalcHours,
  mapAssignmentRow,
  mapDailyStatusRow,
  mapJobRow,
} from '../lib/crewPayroll'
import { greekWeekdayLong, isoDateToGreek, greekCapsLabel } from '../lib/greekDate'
import {
  MONTH_LABELS,
  MONTH_SHORT,
  splitTechName,
  techPhotoUrl,
  estimateAmount,
  formatEuro,
  formatEuroPlain,
  formatMatrixLoan,
  formatMatrixTicket,
} from '../lib/payrollAnalysis'
import {
  emptyEarningsForm,
  earningsFromDb,
} from '../lib/techEarnings'
import { fromElInputValue, parseElNumber, toElInputDisplay, formatElNumber } from '../lib/numberFormat'
import {
  buildOfficeMonthSummary,
  calcOfficeWorkedHours,
  emptyManualDay,
  isValidTimeHHMM,
  loadWorkHours,
  manualHoursToEntries,
  maskTimeInput,
  monthDateList,
  snapToHalfHour,
  upsertWorkHours,
} from '../lib/workHours'
import {
  agreementStatusLabel,
  createAgreementVersionAndSyncMirror,
  ensureActiveAgreementFromEarnings,
  findActiveAgreement,
  isAgreementActive,
  loadAgreementVersions,
  patchActiveAgreementToggles,
  snapshotToForm,
} from '../lib/techAgreementVersions'
import {
  PAYMENT_TYPES,
  emptyPaymentForm,
  formatPaymentCredit,
  paymentToDb,
  paymentTypeLabel,
} from '../lib/techPayments'
import { buildPaymentsDisplayList, isLoanDisbursementRow, isLoanInstallmentRow, loanRowAmount } from '../lib/loanUi'
import { exportMonthPayrollToExcel } from '../lib/monthPayrollExport'
import { exportMonthInvoicesToExcel, exportMonthTemporaryToExcel } from '../lib/monthInvoiceExport'
import {
  computeLedgerBalances,
  ledgerRowKey,
  buildLedgerDescriptionForType,
  buildLedgerAmountForType,
  buildLedgerYearMatrix,
  extractLedgerAmount,
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
import { employmentLabel, personnelIssuesInvoice, getLedgerCategoryPolicy, isTemporaryPersonnel } from '../lib/personnel'
import PersonnelPanel from './PersonnelPanel'
import MovementModal from './MovementModal'
import LoanModal from './LoanModal'
import LoanManagementModal from './LoanManagementModal'
import TemporaryPayablesModal, {
  fetchTemporaryPayablesSummary,
} from './TemporaryPayablesModal'
import EarningsPackageForm from './EarningsPackageForm'
import GreekDateInput from './GreekDateInput'
import { useDraggableModal, MODAL_POS_KEYS } from '../lib/useDraggableModal'
import {
  loadSidebarWidth,
  saveSidebarWidth,
  PERSONNEL_SIDEBAR_WIDTH_KEY,
} from '../lib/modalSize'
import LedgerAnalysisGrid from './LedgerAnalysisGrid'
import DarkSelect from './DarkSelect'

/** Ώρες στο grid: 0 / κενό → παύλα. */
function formatHoursDash(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return formatElNumber(n, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })
}

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
  const [monthExporting, setMonthExporting] = useState(false)
  const [invoiceExporting, setInvoiceExporting] = useState(false)
  const [temporaryExporting, setTemporaryExporting] = useState(false)
  const [personnelSidebarKind, setPersonnelSidebarKind] = useState('permanent')
  const [temporaryPayablesOpen, setTemporaryPayablesOpen] = useState(false)
  const [temporaryPayablesHint, setTemporaryPayablesHint] = useState({
    totalInvoice: 0,
    totalCash: 0,
  })
  const [temporaryPayablesHintLoading, setTemporaryPayablesHintLoading] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    loadSidebarWidth(PERSONNEL_SIDEBAR_WIDTH_KEY, 320)
  )
  const sidebarResizeRef = useRef(null)
  const {
    panelStyle: analysisPanelStyle,
    dragHandleProps: analysisDragHandleProps,
    dragHandleClassName: analysisDragHandleClassName,
  } = useDraggableModal(!embedded, MODAL_POS_KEYS.techAnalysis)
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
  const [agreementVersions, setAgreementVersions] = useState([])
  const [agreementsLoading, setAgreementsLoading] = useState(false)
  const [agreementsSaving, setAgreementsSaving] = useState(false)
  const [agreementsError, setAgreementsError] = useState(null)
  const [agreementsMissing, setAgreementsMissing] = useState(false)
  const [agreementEditorOpen, setAgreementEditorOpen] = useState(false)
  const [agreementViewOpen, setAgreementViewOpen] = useState(false)
  const [agreementViewRow, setAgreementViewRow] = useState(null)
  const [agreementDraftForm, setAgreementDraftForm] = useState(() => emptyEarningsForm())
  const [agreementStartDate, setAgreementStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [payments, setPayments] = useState([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [paymentsSaving, setPaymentsSaving] = useState(false)
  const [paymentsError, setPaymentsError] = useState(null)
  const [paymentsMissing, setPaymentsMissing] = useState(false)
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm)
  const [ledgerRows, setLedgerRows] = useState([])
  const [yearLedgerRows, setYearLedgerRows] = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState(null)
  const [ledgerMissing, setLedgerMissing] = useState(false)
  const [ledgerTick, setLedgerTick] = useState(0)
  const [monthImportSaving, setMonthImportSaving] = useState(false)
  const [monthImportMessage, setMonthImportMessage] = useState(null)
  const [hoursTransferSaving, setHoursTransferSaving] = useState(false)
  const [manualHours, setManualHours] = useState({})
  const [workHoursDirty, setWorkHoursDirty] = useState(false)
  const [workHoursLoading, setWorkHoursLoading] = useState(false)
  const [workHoursSaving, setWorkHoursSaving] = useState(false)
  const [workHoursError, setWorkHoursError] = useState(null)
  const [workHoursMissing, setWorkHoursMissing] = useState(false)
  const [movementOpen, setMovementOpen] = useState(false)
  const [loanOpen, setLoanOpen] = useState(false)
  const [loanManagementOpen, setLoanManagementOpen] = useState(false)
  const [selectedRowData, setSelectedRowData] = useState(null)
  const [selectedLedgerRowKey, setSelectedLedgerRowKey] = useState(null)
  const [movementPresetTypeId, setMovementPresetTypeId] = useState(null)
  const [movementPresetSide, setMovementPresetSide] = useState(null)
  const [movementPresetDescription, setMovementPresetDescription] = useState(null)
  const [movementPresetAmount, setMovementPresetAmount] = useState(null)
  const [movementPresetPostToInvoice, setMovementPresetPostToInvoice] = useState(null)
  const [transactionTypes, setTransactionTypes] = useState([])
  const [transactionTypesError, setTransactionTypesError] = useState(null)

  useEffect(() => {
    setAnalysisYear(initialYear)
    setSelectedMonth(initialMonth)
  }, [tech?.id, initialYear, initialMonth])

  useEffect(() => {
    saveSidebarWidth(PERSONNEL_SIDEBAR_WIDTH_KEY, sidebarWidth)
  }, [sidebarWidth])

  useEffect(() => {
    const onMove = (e) => {
      const d = sidebarResizeRef.current
      if (!d) return
      const next = Math.min(520, Math.max(200, d.startWidth + (e.clientX - d.startX)))
      setSidebarWidth(next)
    }
    const onUp = () => {
      sidebarResizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

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
          if (data) {
            void ensureActiveAgreementFromEarnings(tech, data).then(() => {
              if (!cancelled) void loadAgreements()
            })
          }
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
      setAgreementVersions([])
      return
    }
    setAgreementsLoading(true)
    setAgreementsError(null)
    try {
      const { rows, missingTable, error } = await loadAgreementVersions(tech.id)
      setAgreementsMissing(missingTable)
      setAgreementsError(error)
      setAgreementVersions(rows)
    } catch (err) {
      setAgreementsMissing(isMissingTableError(err))
      setAgreementsError(
        formatSupabaseError(err, {
          table: 'tech_agreement_versions',
          clientLabel: 'DIAS ERP',
        })
      )
      setAgreementVersions([])
    } finally {
      setAgreementsLoading(false)
    }
  }

  useEffect(() => {
    setAgreementEditorOpen(false)
    setAgreementViewOpen(false)
    setAgreementViewRow(null)
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
      try {
        const { data, error } = await diasClient
          .from('tech_ledger_view')
          .select('*')
          .eq('tech_id', String(tech.id))
          .eq('month', Number(selectedMonth))
          .eq('year', Number(analysisYear))
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

  // Ετήσιο ledger για τη μήτρα Απολαβών (όλοι οι μήνες του analysisYear)
  useEffect(() => {
    if (!tech?.id) {
      setYearLedgerRows([])
      return
    }

    let cancelled = false

    async function loadYearLedger() {
      try {
        const { data, error } = await diasClient
          .from('tech_ledger_view')
          .select('*')
          .eq('tech_id', String(tech.id))
          .eq('year', Number(analysisYear))
          .order('month', { ascending: true })
          .order('entry_date', { ascending: true })

        if (cancelled) return

        if (error) {
          console.warn('[year ledger]', error.message || error)
          setYearLedgerRows([])
        } else {
          setYearLedgerRows(data || [])
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[year ledger]', err?.message || err)
          setYearLedgerRows([])
        }
      }
    }

    loadYearLedger()
    return () => {
      cancelled = true
    }
  }, [tech?.id, analysisYear, ledgerTick, payments.length])

  // Ώρες γραφείου (work_hours) — μόνο όταν in_office
  useEffect(() => {
    if (!tech?.id || tech.in_office !== true) {
      setManualHours({})
      setWorkHoursDirty(false)
      setWorkHoursError(null)
      setWorkHoursMissing(false)
      return
    }

    let cancelled = false
    async function load() {
      setWorkHoursLoading(true)
      setWorkHoursError(null)
      try {
        const result = await loadWorkHours({
          techId: tech.id,
          year: analysisYear,
          month: selectedMonth,
        })
        if (cancelled) return
        setWorkHoursMissing(result.missingTable)
        setWorkHoursError(result.error)
        setManualHours(result.byDate || {})
        setWorkHoursDirty(false)
      } catch (err) {
        if (!cancelled) {
          setWorkHoursError(err?.message || String(err))
          setManualHours({})
        }
      } finally {
        if (!cancelled) setWorkHoursLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [tech?.id, tech?.in_office, analysisYear, selectedMonth])

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
    setMovementPresetPostToInvoice(null)
  }, [activeTab])

  // Έκτακτοι: χωρίς Αποδοχές / Συμφωνίες / Αναλυτικά — fallback στο analysis
  useEffect(() => {
    if (!isTemporaryPersonnel(tech)) return
    if (activeTab === 'earnings' || activeTab === 'agreements' || activeTab === 'movements') {
      setActiveTab('analysis')
    }
  }, [tech?.id, tech?.employment_type, activeTab])

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
    setMovementPresetPostToInvoice(
      preset.postToInvoice === true ? true : preset.postToInvoice === false ? false : null
    )

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
    setMovementPresetPostToInvoice(null)
    setMovementOpen(true)
  }

  const openMovementViewSelected = (rowArg) => {
    const row =
      rowArg || ledgerDisplayRows.find((r) => ledgerRowKey(r) === selectedLedgerRowKey)
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

  const handleDeleteLedgerEntry = async () => {
    if (!selectedLedgerRowKey) return

    const row = ledgerDisplayRows.find((r) => ledgerRowKey(r) === selectedLedgerRowKey)
    if (!row) return

    if (row.__template === true) {
      toast.error('Δεν μπορείτε να διαγράψετε μια εικονική εγγραφή/πρότυπο.')
      return
    }

    if (!row.id) {
      toast.error('Δεν μπορείτε να διαγράψετε μια εικονική εγγραφή/πρότυπο.')
      return
    }

    if (!window.confirm('Είστε σίγουροι ότι θέλετε να διαγράψετε την επιλεγμένη εγγραφή;')) {
      return
    }

    const targetTable = row.source === 'PAYMENT' ? 'payment_entries' : 'payroll_entries'

    setLedgerError(null)
    try {
      const { error } = await diasClient.from(targetTable).delete().eq('id', row.id)
      if (error) {
        const msg = formatSupabaseError(error, { table: targetTable, clientLabel: 'DIAS ERP' })
        setLedgerError(msg)
        toast.error(msg || 'Αποτυχία διαγραφής.')
        return
      }
      setLedgerTick((n) => n + 1)
      setSelectedLedgerRowKey(null)
      setSelectedRowData(null)
      toast.success('Η εγγραφή διαγράφηκε επιτυχώς.')
    } catch (err) {
      const msg =
        formatSupabaseError(err, { table: targetTable, clientLabel: 'DIAS ERP' }) ||
        err?.message ||
        String(err)
      setLedgerError(msg)
      toast.error(msg)
    }
  }

  const closeMovement = () => {
    setMovementOpen(false)
    setSelectedRowData(null)
    setMovementPresetTypeId(null)
    setMovementPresetSide(null)
    setMovementPresetDescription(null)
    setMovementPresetAmount(null)
    setMovementPresetPostToInvoice(null)
  }

  const findTypeByDescription = (label) =>
    resolveTransactionType(typeLookup, { description: label, typeCode: label })

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
        agreements: agreementVersions,
        transactionTypes,
        existingLedgerRows: ledgerRows,
      })
      const msg = result.message || 'Ο μήνας δημιουργήθηκε επιτυχώς.'
      setMonthImportMessage(msg)
      setLedgerTick((n) => n + 1)
      toast.success(msg)
    } catch (err) {
      const msg = err?.message || String(err)
      setLedgerError(msg)
      toast.error(msg)
    } finally {
      setMonthImportSaving(false)
    }
  }

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
          yM: 0,
          yL: 0,
          yTim: 0,
          ticket: 0,
          loan: 0,
          loanCount: 0,
        })),
        totals: {
          sigma: 0,
          pi: 0,
          yM: 0,
          yL: 0,
          yTim: 0,
          ticket: 0,
          loan: 0,
          loanCount: 0,
        },
        avg: 0,
        selectedSettled: () => false,
        yearSettled: false,
      }
    }

    const yearPayrolls = (payrolls || []).filter((p) => {
      const matchesTech =
        String(p.tech_id ?? '') === String(tech.id ?? '') ||
        p.tech_name === tech.name ||
        p.technician_name === tech.name ||
        p.name === tech.name
      if (!matchesTech) return false
      const period = String(p.period || '')
      if (/^\d{4}-\d{2}/.test(period)) {
        return Number(period.slice(0, 4)) === Number(analysisYear)
      }
      return Number(p.year) === Number(analysisYear)
    })

    return buildLedgerYearMatrix(yearLedgerRows, analysisYear, yearPayrolls)
  }, [tech, analysisYear, yearLedgerRows, payrolls])

  /** Σύνολο εκταμιεύσεων δανείου (τύπος 95) για το επιλεγμένο έτος. */
  const yearLoanDisbursementsTotal = useMemo(() => {
    let sum = 0
    for (const row of yearLedgerRows || []) {
      if (!isLoanDisbursementRow(row)) continue
      sum += loanRowAmount(row)
    }
    return Math.round(sum * 100) / 100
  }, [yearLedgerRows])

  const formatMatrixCell = (value) => {
    const n = Number(value) || 0
    if (!n) return '-'
    return formatEuro(n)
  }

  /** Υπόλοιπα μήτρας: το 0 εμφανίζεται ως 0,00 € (όχι παύλα). */
  const formatMatrixBalance = (value) => {
    const n = Number(value) || 0
    if (!Number.isFinite(n)) return formatEuro(0)
    return formatEuro(n)
  }
  const selectedPayroll = monthlyPayrolls[selectedMonth - 1]
  const movements = selectedPayroll?.rows || []
  const isOfficeEmployee = tech?.in_office === true
  const officeDayList = useMemo(
    () => (isOfficeEmployee ? monthDateList(analysisYear, selectedMonth) : []),
    [isOfficeEmployee, analysisYear, selectedMonth]
  )

  const officeOtThreshold = useMemo(() => {
    const n = Number(String(earningsForm?.overtime_from ?? '').replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : 8
  }, [earningsForm?.overtime_from])

  const officeSummary = useMemo(() => {
    if (!isOfficeEmployee) return null
    return buildOfficeMonthSummary(manualHoursToEntries(manualHours), {
      otThreshold: officeOtThreshold,
      techName: tech?.displayName || tech?.name || '',
    })
  }, [isOfficeEmployee, manualHours, officeOtThreshold, tech?.displayName, tech?.name])

  const selectedSummary = isOfficeEmployee
    ? officeSummary
    : selectedPayroll?.summary
  const selectedSalary = salaryMatrix.months[selectedMonth - 1]
  const monthSettled = salaryMatrix.selectedSettled?.(selectedMonth)

  const handleMonthExcelExport = async () => {
    if (monthExporting) return
    setMonthExporting(true)
    try {
      const { rowCount, filename } = await exportMonthPayrollToExcel({
        month: selectedMonth,
        year: analysisYear,
        personnel,
      })
      toast.success(`Εξαγωγή ολοκληρώθηκε · ${rowCount} τεχνικοί · ${filename}`)
    } catch (err) {
      const msg = err?.message || String(err)
      toast.error(msg || 'Αποτυχία εξαγωγής')
    } finally {
      setMonthExporting(false)
    }
  }

  const handleInvoiceExcelExport = async () => {
    if (invoiceExporting) return
    setInvoiceExporting(true)
    try {
      const { rowCount, filename } = await exportMonthInvoicesToExcel({
        month: selectedMonth,
        year: analysisYear,
        personnel,
      })
      toast.success(`Εξαγωγή τιμολογίων · ${rowCount} τεχνικοί · ${filename}`)
    } catch (err) {
      const msg = err?.message || String(err)
      toast.error(msg || 'Αποτυχία εξαγωγής τιμολογίων')
    } finally {
      setInvoiceExporting(false)
    }
  }

  const handleTemporaryExcelExport = async () => {
    if (temporaryExporting) return
    setTemporaryExporting(true)
    try {
      const { rowCount, invoiceCount, cashCount, filename } = await exportMonthTemporaryToExcel({
        month: selectedMonth,
        year: analysisYear,
        personnel,
      })
      toast.success(
        `Εξαγωγή έκτακτων · ${rowCount} γραμμές (ΤΙΜ ${invoiceCount} · μετρητά ${cashCount}) · ${filename}`
      )
    } catch (err) {
      const msg = err?.message || String(err)
      toast.error(msg || 'Αποτυχία εξαγωγής έκτακτων')
    } finally {
      setTemporaryExporting(false)
    }
  }

  const handleTransferHours = async () => {
    if (!tech?.id || hoursTransferSaving) return
    setHoursTransferSaving(true)
    setLedgerError(null)
    try {
      if (!isOfficeEmployee && !tech._adminTech && !tech.admin_tech_id) {
        throw new Error('Ο υπάλληλος δεν έχει σύνδεση με Admin για ώρες βάρδιας.')
      }
      if (isOfficeEmployee && !(selectedSummary?.totalHours > 0)) {
        throw new Error(
          'Δεν υπάρχουν συμπληρωμένες ώρες γραφείου για τον μήνα. Συμπλήρωσε ρολόγια στα Αναλυτικά στοιχεία.'
        )
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
      const msg = result.message || 'Οι ώρες μεταφέρθηκαν επιτυχώς.'
      setMonthImportMessage(msg)
      setLedgerTick((n) => n + 1)
      toast.success(msg)
    } catch (err) {
      const msg = err?.message || String(err)
      setLedgerError(msg)
      toast.error(msg)
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

  const ledgerBalances = useMemo(
    () => computeLedgerBalances(ledgerDisplayRows),
    [ledgerDisplayRows]
  )

  /** Πληρωμές UI: κρύβει δόσεις 94 · δείχνει κανονικά εκταμίευση 95. */
  const paymentsDisplayList = useMemo(
    () => buildPaymentsDisplayList(payments),
    [payments]
  )

  const notifyLoanHoldsInMonth = () => {
    for (const row of ledgerRows || []) {
      if (row.__template) continue
      if (!isLoanInstallmentRow(row)) continue
      const amount = Number(row.amount) || extractLedgerAmount(row).amount || 0
      toast(`Εφαρμόστηκε κράτηση: ${row.notes || 'Δάνειο'} - ${amount}€`, {
        icon: 'ℹ️',
      })
    }
  }

  /** Δεξιά στήλη ενεργειών — ΚΕΦΑΛΑΙΑ χωρίς τόνους · εξοφλήσεις autofill από υπόλοιπα. */
  const ledgerActionButtons = useMemo(() => {
    const policy = getLedgerCategoryPolicy(tech)
    const bal1 = Number(ledgerBalances?.balance1) || 0
    const bal2 = Number(ledgerBalances?.balance2) || 0
    const balInv = Number(ledgerBalances?.invoice) || 0
    const items = [
      {
        label: 'ΔΙΑΓΡΑΦΗ',
        action: handleDeleteLedgerEntry,
        disabled: !selectedLedgerRowKey,
      },
      { label: 'ΠΛΗΡΩΜΗ', tab: 'payments' },
    ]
    if (policy.allowSalary) {
      items.push({
        label: 'ΕΞΟΦΛΗΣΗ(Μ)',
        typeId: 91,
        side: 'CREDIT',
        amount: bal1 > 0 ? bal1 : null,
        disabled: !tech || bal1 <= 0,
        title:
          bal1 <= 0
            ? 'Δεν υπάρχει υπόλοιπο μισθού για εξόφληση'
            : 'Εξοφληση μισθου (Μισθος Πιστ.)',
      })
    }
    if (policy.allowOther) {
      items.push({
        label: 'ΕΞΟΦΛΗΣΗ(Λ)',
        typeId: 92,
        side: 'CREDIT',
        amount: bal2 > 0 ? bal2 : null,
        disabled: !tech || bal2 <= 0,
        title:
          bal2 <= 0
            ? 'Δεν υπάρχει υπόλοιπο λοιπών για εξόφληση'
            : 'Εξοφληση λοιπων (Λοιπα Πιστ.)',
      })
    }
    if (policy.allowInvoice) {
      items.push({
        label: 'ΕΞΟΦΛΗΣΗ(ΤΙΜ)',
        typeId: 93,
        side: 'CREDIT',
        postToInvoice: true,
        amount: balInv > 0 ? balInv : null,
        disabled: !tech || balInv <= 0,
        title:
          balInv <= 0
            ? 'Δεν υπάρχει υπόλοιπο τιμολογίου για εξόφληση'
            : 'Εξοφληση τιμολογιου (Τιμολογιο Πιστ.)',
      })
    }
    return items
  }, [tech, selectedLedgerRowKey, ledgerBalances])

  const ledgerCategoryPolicy = useMemo(() => getLedgerCategoryPolicy(tech), [tech])
  const techIsTemporary = isTemporaryPersonnel(tech)
  /** Toolbar Excel/οφειλές: ακολουθεί το tab αριστερά (Έκτακτοι). */
  const showTemporaryToolbar =
    embedded && typeof onPersonSelect === 'function'
      ? personnelSidebarKind === 'temporary'
      : techIsTemporary

  useEffect(() => {
    if (!showTemporaryToolbar) {
      setTemporaryPayablesHint({ totalInvoice: 0, totalCash: 0 })
      setTemporaryPayablesHintLoading(false)
      return
    }
    let cancelled = false
    setTemporaryPayablesHintLoading(true)
    fetchTemporaryPayablesSummary(personnel)
      .then((summary) => {
        if (cancelled) return
        setTemporaryPayablesHint({
          totalInvoice: summary.totalInvoice || 0,
          totalCash: summary.totalCash || 0,
        })
      })
      .catch(() => {
        if (!cancelled) setTemporaryPayablesHint({ totalInvoice: 0, totalCash: 0 })
      })
      .finally(() => {
        if (!cancelled) setTemporaryPayablesHintLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showTemporaryToolbar, personnel, temporaryPayablesOpen, yearLedgerRows])

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
  const hasAdminHours = Boolean(tech?._adminTech || tech?.admin_tech_id)
  const issuesInvoice = personnelIssuesInvoice(tech)

  const patchManualTime = (dateIso, field, value) => {
    const masked = maskTimeInput(value)
    setManualHours((prev) => {
      const cur = { ...emptyManualDay(), ...(prev[dateIso] || {}), [field]: masked }
      const calc = calcOfficeWorkedHours(cur.time_start, cur.time_end)
      cur.worked_hours = calc?.hours ?? 0
      return { ...prev, [dateIso]: cur }
    })
    setWorkHoursDirty(true)
  }

  const blurManualTime = (dateIso, field, value) => {
    const snapped = snapToHalfHour(maskTimeInput(value))
    if (snapped === String(value || '').trim()) return
    patchManualTime(dateIso, field, snapped)
  }

  const handleSaveWorkHours = async () => {
    if (!tech?.id || !isOfficeEmployee || workHoursSaving) return
    setWorkHoursSaving(true)
    setWorkHoursError(null)
    try {
      await upsertWorkHours({ techId: tech.id, days: manualHours })
      setWorkHoursDirty(false)
      setWorkHoursMissing(false)
      toast.success('Οι ώρες γραφείου αποθηκεύτηκαν.')
    } catch (err) {
      setWorkHoursMissing(Boolean(err?.missingTable))
      const msg = err?.message || String(err)
      setWorkHoursError(msg)
      toast.error(msg)
    } finally {
      setWorkHoursSaving(false)
    }
  }

  const handleSave = async () => {
    if (!tech) return
    const amount =
      selectedSalary?.sigma ||
      estimateAmount(tech, selectedSummary?.workDays ?? 0, selectedSummary?.totalHours ?? 0)
    const ticket_restaurant = parseElNumber(earningsForm?.ticket_amount) || 0
    const driver_allowance = parseElNumber(earningsForm?.driver_allowance) || 0
    try {
      await onSaveToErp?.({
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
        ticket_restaurant,
        driver_allowance,
        year: analysisYear,
        month: selectedMonth,
      })
      toast.success('Οριστική αποθήκευση ERP ολοκληρώθηκε.')
    } catch (err) {
      toast.error(
        formatSupabaseError(err, { table: 'payrolls', clientLabel: 'DIAS ERP' }) ||
          err?.message ||
          'Αποτυχία αποθήκευσης ERP.'
      )
    }
  }

  const patchEarnings = (field, value) => {
    setEarningsForm((prev) => ({ ...prev, [field]: value }))
    setEarningsDirty(true)
  }

  const patchAutoTransfer = (transferKey, checked) => {
    if (!transferKey) return
    setEarningsForm((prev) => ({
      ...prev,
      auto_transfer_settings: {
        ...(prev.auto_transfer_settings || {}),
        [transferKey]: Boolean(checked),
      },
    }))
    setEarningsDirty(true)
  }

  const patchFixedExpense = (earningsKey, checked) => {
    if (!earningsKey) return
    setEarningsForm((prev) => ({
      ...prev,
      fixed_expense_settings: {
        ...(prev.fixed_expense_settings || {}),
        [earningsKey]: Boolean(checked),
      },
    }))
    setEarningsDirty(true)
  }

  const handleSaveEarnings = async () => {
    if (!tech || earningsMissing) return
    setEarningsSaving(true)
    setEarningsError(null)
    try {
      await patchActiveAgreementToggles({
        techId: tech.id,
        form: earningsForm,
      })
      const { data, error } = await diasClient
        .from('tech_earnings')
        .select('*')
        .eq('tech_id', String(tech.id))
        .maybeSingle()
      if (error) throw error
      if (data) {
        setEarningsForm(earningsFromDb(data))
        setEarningsRecordId(data.id || null)
      }
      setEarningsDirty(false)
      await loadAgreements()
      toast.success('Οι λειτουργικές ρυθμίσεις αποθηκεύτηκαν.')
    } catch (err) {
      if (isMissingTableError(err) || String(err?.message || '').includes('patch_active_agreement')) {
        setAgreementsMissing(true)
        const msg =
          'Λείπει tech_agreement_versions / RPC. Τρέξε supabase/31_tech_agreement_versions.sql στο DIAS.'
        setEarningsError(msg)
        toast.error(msg)
      } else {
        setEarningsMissing(isMissingTableError(err))
        const msg =
          formatSupabaseError(err, {
            table: 'tech_earnings',
            clientLabel: 'DIAS ERP',
          }) || err?.message
        setEarningsError(msg)
        toast.error(msg || 'Αποτυχία αποθήκευσης ρυθμίσεων.')
      }
    } finally {
      setEarningsSaving(false)
    }
  }

  const handleResetEarnings = () => {
    toast('Τα ποσά αλλάζουν μόνο με Νέα Συμφωνία.', { icon: 'ℹ️' })
  }

  const handleDeleteEarnings = async () => {
    toast('Η διαγραφή πακέτου γίνεται μέσω νέας συμφωνίας / ιστορικού.', { icon: 'ℹ️' })
  }

  const activeAgreement = useMemo(
    () => findActiveAgreement(agreementVersions),
    [agreementVersions]
  )

  const openNewAgreement = () => {
    const prefill = activeAgreement
      ? snapshotToForm(activeAgreement.earnings_snapshot)
      : earningsForm
    setAgreementDraftForm(prefill)
    setAgreementStartDate(new Date().toISOString().slice(0, 10))
    setAgreementEditorOpen(true)
  }

  const openViewAgreement = (row) => {
    setAgreementViewRow(row)
    setAgreementViewOpen(true)
  }

  const patchAgreementDraft = (field, value) => {
    setAgreementDraftForm((prev) => ({ ...prev, [field]: value }))
  }

  const patchAgreementDraftAuto = (transferKey, checked) => {
    if (!transferKey) return
    setAgreementDraftForm((prev) => ({
      ...prev,
      auto_transfer_settings: {
        ...(prev.auto_transfer_settings || {}),
        [transferKey]: Boolean(checked),
      },
    }))
  }

  const patchAgreementDraftFixed = (earningsKey, checked) => {
    if (!earningsKey) return
    setAgreementDraftForm((prev) => ({
      ...prev,
      fixed_expense_settings: {
        ...(prev.fixed_expense_settings || {}),
        [earningsKey]: Boolean(checked),
      },
    }))
  }

  const handleSaveNewAgreement = async () => {
    if (!tech?.id || agreementsMissing) return
    if (!agreementStartDate) {
      toast.error('Συμπλήρωσε ημερομηνία έναρξης.')
      return
    }
    setAgreementsSaving(true)
    setAgreementsError(null)
    try {
      const { earnings } = await createAgreementVersionAndSyncMirror({
        tech,
        startDate: agreementStartDate,
        form: agreementDraftForm,
        earningsRecordId,
      })
      setEarningsForm(earningsFromDb(earnings))
      setEarningsRecordId(earnings?.id || null)
      setEarningsDirty(false)
      setAgreementEditorOpen(false)
      await loadAgreements()
      toast.success('Η νέα συμφωνία αποθηκεύτηκε και συγχρονίστηκε στις Αποδοχές.')
    } catch (err) {
      const msg = String(err?.message || err || '')
      let display
      if (
        msg.includes('create_tech_agreement_version') ||
        msg.includes('tech_agreement_versions') ||
        isMissingTableError(err)
      ) {
        setAgreementsMissing(true)
        display =
          'Λείπει πίνακας/RPC tech_agreement_versions. Τρέξε supabase/31_tech_agreement_versions.sql στο DIAS.'
      } else if (msg.includes('foreign key') || msg.includes('personnel')) {
        display =
          'Ο υπάλληλος πρέπει να υπάρχει στο DIAS personnel (tech_id). Αποθήκευσε/εισήγαγε πρώτα το προσωπικό.'
      } else {
        display =
          formatSupabaseError(err, {
            table: 'tech_agreement_versions',
            clientLabel: 'DIAS ERP',
          }) || msg
      }
      setAgreementsError(display)
      toast.error(display || 'Αποτυχία αποθήκευσης συμφωνίας.')
    } finally {
      setAgreementsSaving(false)
    }
  }

  const handleDeletePayment = async (row) => {
    if (!row?.id) return
    if (!window.confirm('Είστε σίγουροι ότι θέλετε να διαγράψετε αυτή την πληρωμή;')) {
      return
    }
    try {
      const { error } = await diasClient.from('payment_entries').delete().eq('id', row.id)
      if (error) throw error
      await loadPayments()
      setLedgerTick((n) => n + 1)
      toast.success('Η πληρωμή διαγράφηκε.')
    } catch (err) {
      const msg =
        formatSupabaseError(err, { table: 'payment_entries', clientLabel: 'DIAS ERP' }) ||
        err?.message ||
        String(err)
      setPaymentsError(msg)
      toast.error(msg)
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
      const payload = paymentToDb(paymentForm, tech, {
        month: selectedMonth,
        year: analysisYear,
      })
      const { error } = await diasClient.from('payment_entries').insert(payload)
      if (error) throw error
      setPaymentForm(emptyPaymentForm())
      await loadPayments()
      setLedgerTick((n) => n + 1)
      toast.success('Η πληρωμή αποθηκεύτηκε.')
    } catch (err) {
      const msg = String(err?.message || err || '')
      let display
      if (isMissingTableError(err) || msg.includes('payment_date') || msg.includes('payment_type')) {
        setPaymentsMissing(true)
        display =
          'Λείπουν στήλες payment_entries. Τρέξε supabase/04_payment_entries.sql στο DIAS.'
      } else if (msg.includes('foreign key') || msg.includes('personnel')) {
        display = 'Ο υπάλληλος πρέπει να υπάρχει στο DIAS personnel (tech_id).'
      } else {
        display =
          formatSupabaseError(err, { table: 'payment_entries', clientLabel: 'DIAS ERP' }) || msg
      }
      setPaymentsError(display)
      toast.error(display)
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
  ].filter((tab) => {
    if (!techIsTemporary) return true
    return tab.id !== 'earnings' && tab.id !== 'agreements' && tab.id !== 'movements'
  })

  const usePersonnelSidebar = embedded && typeof onPersonSelect === 'function'

  const techSidebar = usePersonnelSidebar ? (
    <PersonnelPanel
      variant="sidebar"
      personnel={personnel}
      adminTechs={adminTechs}
      selectedId={selectedPersonId}
      onSelect={onPersonSelect}
      onMutated={onPersonnelMutated}
      onSidebarKindChange={setPersonnelSidebarKind}
      width={sidebarWidth}
    />
  ) : embedded && onTechChange ? (
    <aside className="flex h-full min-h-0 max-h-56 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md md:max-h-full md:w-72 lg:w-80">
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
        <div
          className={`relative flex items-center justify-between border-b border-white/10 px-5 py-3 ${analysisDragHandleClassName}`}
          {...analysisDragHandleProps}
        >
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
        <div className="relative z-20 overflow-visible rounded-2xl border border-white/10 bg-slate-900/75 p-3 shadow-xl backdrop-blur-md sm:p-4">
          <div className="flex flex-col gap-3 overflow-visible lg:flex-row lg:items-center">
            <div className="flex flex-nowrap items-end gap-2 overflow-visible">
              <div className="flex shrink-0 flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Μήνας
                </span>
                <div className="inline-flex h-[38px] items-center gap-0.5 rounded-xl border border-cyan-500/25 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-0.5 shadow-lg shadow-cyan-950/20">
                  <button
                    type="button"
                    aria-label="Προηγούμενος μήνας"
                    title="Προηγούμενος μήνας"
                    onClick={() => {
                      if (selectedMonth <= 1) {
                        setSelectedMonth(12)
                        setAnalysisYear((y) => Number(y) - 1)
                      } else {
                        setSelectedMonth((m) => Number(m) - 1)
                      }
                    }}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-cyan-200 shadow-inner transition hover:border-cyan-400/50 hover:bg-cyan-500/20 hover:text-white active:scale-95"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                      <path
                        fillRule="evenodd"
                        d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <span
                    id="analysis-month"
                    className="min-w-[7.5rem] select-none px-1 text-center text-xs font-bold uppercase leading-none tracking-[0.08em] text-white"
                  >
                    {greekCapsLabel(MONTH_LABELS[selectedMonth - 1] || '')}
                  </span>
                  <button
                    type="button"
                    aria-label="Επόμενος μήνας"
                    title="Επόμενος μήνας"
                    onClick={() => {
                      if (selectedMonth >= 12) {
                        setSelectedMonth(1)
                        setAnalysisYear((y) => Number(y) + 1)
                      } else {
                        setSelectedMonth((m) => Number(m) + 1)
                      }
                    }}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-cyan-200 shadow-inner transition hover:border-cyan-400/50 hover:bg-cyan-500/20 hover:text-white active:scale-95"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                      <path
                        fillRule="evenodd"
                        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="analysis-year" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Έτος
                </label>
                <div className="inline-flex h-[38px] items-center gap-0.5 rounded-xl border border-cyan-500/25 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-0.5 shadow-lg shadow-cyan-950/20">
                  <button
                    type="button"
                    aria-label="Προηγούμενο έτος"
                    title="Προηγούμενο έτος"
                    onClick={() =>
                      setAnalysisYear((y) => Math.max(2020, Number(y) - 1))
                    }
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-cyan-200 shadow-inner transition hover:border-cyan-400/50 hover:bg-cyan-500/20 hover:text-white active:scale-95"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                      <path
                        fillRule="evenodd"
                        d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                  <input
                    id="analysis-year"
                    type="number"
                    min={2020}
                    max={2035}
                    value={analysisYear}
                    onChange={(e) => setAnalysisYear(Number(e.target.value) || initialYear)}
                    className="w-[4.25rem] appearance-none border-0 bg-transparent px-0.5 text-center text-xs font-bold uppercase leading-none tracking-[0.08em] text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    aria-label="Επόμενο έτος"
                    title="Επόμενο έτος"
                    onClick={() =>
                      setAnalysisYear((y) => Math.min(2035, Number(y) + 1))
                    }
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-cyan-200 shadow-inner transition hover:border-cyan-400/50 hover:bg-cyan-500/20 hover:text-white active:scale-95"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                      <path
                        fillRule="evenodd"
                        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              {showTechDropdown && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="analysis-tech" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Τεχνικός
                  </label>
                  <DarkSelect
                    id="analysis-tech"
                    value={tech.id}
                    onChange={(v) => {
                      const next = techList.find((t) => String(t.id) === String(v))
                      if (next) onTechChange(next)
                    }}
                    options={techList.map((t) => ({
                      value: t.id,
                      label: t.name,
                    }))}
                    className="min-w-[180px]"
                  />
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-2 text-center">
              <p className="text-[10px] font-semibold tracking-wider text-slate-500">
                {greekCapsLabel('Υπάλληλος')}
              </p>
              <p className="mt-0.5 truncate text-lg font-bold tracking-wide text-white sm:text-xl">
                {[lastName, firstName].filter(Boolean).join(' ') || displayName || '—'}
              </p>
            </div>

            <div className="flex items-start justify-end gap-2">
              {showTemporaryToolbar ? (
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleTemporaryExcelExport}
                      disabled={temporaryExporting}
                      title="Εξαγωγή έκτακτων μήνα: φύλλο Τιμολόγια (καθαρό + ΦΠΑ) και φύλλο Μετρητά (ποσό)"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" aria-hidden>
                        <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.69L6.3 8.49a.75.75 0 00-1.1 1.02l4.25 4.5a.75.75 0 001.1 0l4.25-4.5a.75.75 0 10-1.1-1.02l-2.95 3.12V2.75z" />
                        <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                      </svg>
                      {temporaryExporting ? 'Εξαγωγή...' : 'Εξαγωγή Έκτακτων (Excel)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTemporaryPayablesOpen(true)}
                      title="Συγκεντρωτικές οφειλές έκτακτων (all-time υπόλοιπο)"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-bold text-cyan-100 transition hover:bg-cyan-500/25"
                    >
                      Διαχείριση Οφειλών
                    </button>
                    {!hasAdminHours && (
                      <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                        Χωρίς ώρες Admin
                      </span>
                    )}
                  </div>
                  {!temporaryPayablesHintLoading &&
                  (temporaryPayablesHint.totalInvoice > 0.005 ||
                    temporaryPayablesHint.totalCash > 0.005) ? (
                    <button
                      type="button"
                      onClick={() => setTemporaryPayablesOpen(true)}
                      title="Άνοιγμα διαχείρισης οφειλών"
                      className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-center text-[10px] font-semibold leading-tight text-amber-100/90 transition hover:bg-amber-500/15"
                    >
                      <span className="font-mono tabular-nums">
                        ΤΙΜ: {formatEuroPlain(temporaryPayablesHint.totalInvoice)} €
                      </span>
                      <span className="text-amber-100/40"> · </span>
                      <span className="font-mono tabular-nums">
                        ΜΕΤΡ: {formatEuroPlain(temporaryPayablesHint.totalCash)} €
                      </span>
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={handleInvoiceExcelExport}
                    disabled={invoiceExporting}
                    title="Εξαγωγή Αξίας Τιμολογίου = Υπόλοιπο ΤΙΜ ÷ 0,8 (ίδιο με την προσαύξηση στην οθόνη)"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" aria-hidden>
                      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.69L6.3 8.49a.75.75 0 00-1.1 1.02l4.25 4.5a.75.75 0 001.1 0l4.25-4.5a.75.75 0 10-1.1-1.02l-2.95 3.12V2.75z" />
                      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                    </svg>
                    {invoiceExporting ? 'Εξαγωγή...' : 'Εξαγωγή Τιμολογίων (Excel)'}
                  </button>
                  <button
                    type="button"
                    onClick={handleMonthExcelExport}
                    disabled={monthExporting}
                    title="Εξαγωγή χρεώσεων (δεδουλευμένων) όλου του προσωπικού για τον επιλεγμένο μήνα"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" aria-hidden>
                      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.69L6.3 8.49a.75.75 0 00-1.1 1.02l4.25 4.5a.75.75 0 001.1 0l4.25-4.5a.75.75 0 10-1.1-1.02l-2.95 3.12V2.75z" />
                      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                    </svg>
                    {monthExporting ? 'Εξαγωγή...' : 'Εξαγωγή Μήνα (Excel)'}
                  </button>
                  {!hasAdminHours && (
                    <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                      Χωρίς ώρες Admin
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-col items-center gap-1">
                {tech.employment_type && (
                  <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                    {employmentLabel(tech.employment_type)}
                  </span>
                )}
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
          {!techIsTemporary ? (
            <div className="ml-auto flex shrink-0 flex-col items-end gap-0.5 self-center pr-1">
              <button
                type="button"
                onClick={() => setLoanManagementOpen(true)}
                disabled={!tech}
                title="Διαχείριση δανείων τεχνικού"
                className="rounded-xl border border-amber-500/40 bg-transparent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-100/90 transition hover:border-amber-400/60 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Διαχείριση Δανείων
              </button>
              {tech ? (
                <p className="mr-2 max-w-[16rem] self-start text-left text-[11px] font-bold leading-tight text-slate-300">
                  Εκταμιεύσεις {analysisYear}:{' '}
                  <span className="font-mono tabular-nums text-amber-100/90">
                    {formatEuro(yearLoanDisbursementsTotal)}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {!techIsTemporary ? (
          <>
            <LoanManagementModal
              open={loanManagementOpen}
              tech={tech}
              selectedMonth={selectedMonth}
              analysisYear={analysisYear}
              onClose={() => setLoanManagementOpen(false)}
              onSaved={handleMovementSaved}
              onOpenNewLoan={() => setLoanOpen(true)}
              loanCreateOpen={loanOpen}
            />

            <LoanModal
              open={loanOpen}
              tech={tech}
              selectedMonth={selectedMonth}
              analysisYear={analysisYear}
              onClose={() => setLoanOpen(false)}
              onSaved={handleMovementSaved}
            />
          </>
        ) : null}

        <TemporaryPayablesModal
          open={temporaryPayablesOpen}
          personnel={personnel}
          onClose={() => setTemporaryPayablesOpen(false)}
          onSelectPerson={onPersonSelect}
        />

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
                  {techIsTemporary
                    ? ledgerCategoryPolicy.allowInvoice
                      ? 'Σ = απολαβές (Χρ.) · Π = πληρωμές (Πιστ.) · Υ(ΤΙΜ) = υπόλοιπο — από tech_ledger_view'
                      : 'Π = πληρωμές (Πιστ.) · Υ(Λ) = υπόλοιπο λοιπών — από tech_ledger_view'
                    : 'Σ = απολαβές (Χρ.) · Π = πληρωμές (Πιστ.) · Υ(Μ)/Υ(Λ)/Υ(ΤΙΜ) = υπόλοιπα — από tech_ledger_view'}
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
                        {MONTH_LABELS.map((label, i) => {
                          const monthNum = i + 1
                          const isActive = Number(selectedMonth) === monthNum
                          return (
                          <th
                            key={`month-h-${monthNum}`}
                            aria-selected={isActive}
                            className={`cursor-pointer px-1.5 py-2 text-center font-semibold transition hover:text-cyan-200 ${
                              isActive
                                ? 'bg-amber-400/90 text-slate-950'
                                : 'bg-slate-950/60 text-slate-400'
                            }`}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setSelectedMonth(monthNum)
                            }}
                            title={label}
                          >
                            {MONTH_SHORT[i]}
                          </th>
                          )
                        })}
                        <th className="px-3 py-2 text-right font-semibold text-cyan-300/90">Σύνολο</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!techIsTemporary || ledgerCategoryPolicy.allowInvoice ? (
                        <MatrixRow
                          label="Σ"
                          hint="Απολαβές"
                          selectedMonth={selectedMonth}
                          onSelectMonth={setSelectedMonth}
                          values={salaryMatrix.months.map((m) => formatMatrixCell(m.sigma))}
                          total={formatMatrixCell(salaryMatrix.totals.sigma)}
                        />
                      ) : null}
                      <MatrixRow
                        label="Π"
                        hint="Πληρωμές"
                        selectedMonth={selectedMonth}
                        onSelectMonth={setSelectedMonth}
                        values={salaryMatrix.months.map((m) => formatMatrixCell(m.pi))}
                        total={formatMatrixCell(salaryMatrix.totals.pi)}
                      />
                      {!techIsTemporary ? (
                        <MatrixRow
                          label="Υ (Μ)"
                          hint="Υπόλοιπο Μισθού"
                          selectedMonth={selectedMonth}
                          onSelectMonth={setSelectedMonth}
                          values={salaryMatrix.months.map((m) => formatMatrixBalance(m.yM))}
                          total={formatMatrixBalance(salaryMatrix.totals.yM)}
                        />
                      ) : null}
                      {!techIsTemporary || ledgerCategoryPolicy.allowOther ? (
                        <MatrixRow
                          label="Υ (Λ)"
                          hint="Υπόλοιπο Λοιπών"
                          selectedMonth={selectedMonth}
                          onSelectMonth={setSelectedMonth}
                          values={salaryMatrix.months.map((m) => formatMatrixBalance(m.yL))}
                          total={formatMatrixBalance(salaryMatrix.totals.yL)}
                        />
                      ) : null}
                      {!techIsTemporary || ledgerCategoryPolicy.allowInvoice ? (
                        <MatrixRow
                          label="Υ (ΤΙΜ)"
                          hint="Υπόλοιπο Τιμολογίου"
                          selectedMonth={selectedMonth}
                          onSelectMonth={setSelectedMonth}
                          values={salaryMatrix.months.map((m) => formatMatrixBalance(m.yTim))}
                          total={formatMatrixBalance(salaryMatrix.totals.yTim)}
                        />
                      ) : null}
                      {!techIsTemporary ? (
                        <MatrixRow
                          label="Ticket Restaurant"
                          hint=""
                          selectedMonth={selectedMonth}
                          onSelectMonth={setSelectedMonth}
                          values={salaryMatrix.months.map((m) => formatMatrixTicket(m.ticket))}
                          total={formatMatrixTicket(salaryMatrix.totals.ticket)}
                        />
                      ) : null}
                      {!techIsTemporary ? (
                        <MatrixRow
                          label="Δάνειο"
                          hint=""
                          selectedMonth={selectedMonth}
                          onSelectMonth={setSelectedMonth}
                          values={salaryMatrix.months.map((m) =>
                            formatMatrixLoan(m.loan, m.loanCount)
                          )}
                          total={formatMatrixLoan(salaryMatrix.totals.loan)}
                        />
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/75 px-4 py-3 backdrop-blur-md">
              <SummaryStat
                label="Συνολικές Απολαβές (Έτος)"
                value={formatEuro(salaryMatrix.totals.sigma)}
              />
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
                  showSalaryBalance={ledgerCategoryPolicy.allowSalary}
                  showOtherBalance={ledgerCategoryPolicy.allowOther}
                  footerBalances={{
                    balance: formatEuro(ledgerBalances.balance),
                    balance1: formatEuro(ledgerBalances.balance1),
                    balance2: formatEuro(ledgerBalances.balance2),
                    invoice: formatEuro(ledgerBalances.invoice || 0),
                  }}
                  invoiceGuideData={{
                    netAmount: ledgerBalances.invoice,
                    // Έκτακτοι: απλό καθαρό + ΦΠΑ 24% · χωρίς /0.8 και παρακράτηση
                    simpleVatOnly: techIsTemporary,
                    taxPercent: techIsTemporary
                      ? 0
                      : (() => {
                          const pct = parseElNumber(earningsForm?.extra)
                          return pct != null && Number.isFinite(pct) && pct !== 0 ? pct : 20
                        })(),
                  }}
                  onSelectRow={selectLedgerRow}
                  onOpenCreateForType={openMovementCreate}
                  onOpenEditRow={openMovementViewSelected}
                />
              </div>

              <aside className="flex shrink-0 flex-row gap-2 overflow-x-auto lg:w-36 lg:flex-col lg:self-stretch lg:overflow-visible">
                {!techIsTemporary ? (
                  <button
                    type="button"
                    onClick={handleMonthImport}
                    disabled={monthImportSaving || ledgerLoading || !tech}
                    title="Εισαγωγη στο ledger μονο για Αποδοχες με τικ (ποσο > 0)"
                    className="shrink-0 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40 lg:w-full"
                  >
                    {monthImportSaving ? 'ΔΗΜΙΟΥΡΓΙΑ...' : 'ΔΗΜΙΟΥΡΓΙΑ'}
                  </button>
                ) : null}
                {!techIsTemporary && monthImportMessage ? (
                  <p className="hidden text-[10px] leading-snug text-cyan-200/80 lg:block">
                    {monthImportMessage}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => openMovementCreate()}
                  disabled={!tech}
                  title="Νεα κινηση (χωρις προεπιλεγμενο τυπο)"
                  className="shrink-0 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40 lg:w-full"
                >
                  ΕΙΣΑΓΩΓΗ
                </button>
                {ledgerActionButtons.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={item.disabled}
                    title={item.title}
                    onClick={() => {
                      if (item.tab === 'payments') setActiveTab('payments')
                      else if (typeof item.action === 'function') item.action()
                      else if (item.typeId) {
                        if (item.amount == null && (item.typeId === 91 || item.typeId === 92 || item.typeId === 93)) {
                          toast.error(item.title || 'Δεν υπάρχει υπόλοιπο για εξόφληση')
                          return
                        }
                        if (item.typeId === 91 || item.typeId === 92 || item.typeId === 93) {
                          notifyLoanHoldsInMonth()
                        }
                        openMovementCreate({
                          typeId: item.typeId,
                          side: item.side,
                          postToInvoice: item.postToInvoice === true,
                          amount: item.amount ?? undefined,
                        })
                      } else {
                        const tt = findTypeByDescription(item.label)
                        openMovementCreate({
                          typeId: tt?.id ?? item.typeId,
                          side: item.side || 'DEBIT',
                          postToInvoice: item.postToInvoice === true,
                        })
                      }
                    }}
                    className="shrink-0 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40 lg:w-full"
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
              presetPostToInvoice={movementPresetPostToInvoice}
              presetMonth={selectedMonth}
              presetYear={analysisYear}
              hasInvoice={ledgerMonthContext.hasInvoice}
              onClose={closeMovement}
              onSaved={handleMovementSaved}
            />
          </>
        )}

        {activeTab === 'earnings' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/90">
                Ενεργή Συμφωνία
              </p>
              <p className="mt-0.5 text-sm text-cyan-50">
                {activeAgreement?.start_date
                  ? `Από ${new Date(activeAgreement.start_date).toLocaleDateString('el-GR')} · ποσά μόνο μέσω Νέας Συμφωνίας`
                  : 'Δεν υπάρχει ακόμα ιστορικό συμφωνίας — αποθήκευσε Νέα Συμφωνία ή Αποδοχές για seed.'}
              </p>
            </div>
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
              <div className="min-w-0 flex-1">
                {earningsLoading ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-900/75 px-4 py-12 text-center text-slate-400">
                    Φόρτωση αποδοχών...
                  </div>
                ) : (
                  <EarningsPackageForm
                    form={earningsForm}
                    editMode="toggles-only"
                    issuesInvoice={issuesInvoice}
                    disabled={earningsMissing}
                    tech={tech}
                    onPatchField={patchEarnings}
                    onPatchAutoTransfer={patchAutoTransfer}
                    onPatchFixedExpense={patchFixedExpense}
                    footerNote={
                      earningsDirty
                        ? 'Κίτρινο ✓ = Βασικό · κυανό ✓ = Δημιουργία · μη αποθηκευμένες αλλαγές ρυθμίσεων'
                        : 'Κίτρινο ✓ = Βασικό · κυανό ✓ = Δημιουργία · αποθηκευμένο'
                    }
                  />
                )}
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
                  disabled={earningsMissing || earningsSaving || earningsLoading || !earningsDirty}
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
            </div>
          </div>
        )}

        {activeTab === 'agreements' && (
          <div className="space-y-3">
            {agreementsMissing && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Λείπει ο πίνακας / RPC{' '}
                <code className="rounded bg-black/30 px-1">tech_agreement_versions</code>. Τρέξε{' '}
                <code className="rounded bg-black/30 px-1">supabase/31_tech_agreement_versions.sql</code>{' '}
                στο DIAS SQL Editor.
              </div>
            )}
            {agreementsError && !agreementsMissing && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {agreementsError}
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Ιστορικό συμφωνιών</h3>
                  <p className="text-xs text-slate-400">
                    Master πακέτο αποδοχών · το tab Αποδοχές καθρεφτίζει την ενεργή έκδοση.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openNewAgreement}
                  disabled={!tech || agreementsMissing || agreementsSaving}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-50"
                >
                  Νέα Συμφωνία
                </button>
              </div>
              {agreementsLoading ? (
                <div className="px-4 py-12 text-center text-slate-400">Φόρτωση συμφωνιών...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-2.5 font-semibold">Ημ. Έναρξης</th>
                        <th className="px-3 py-2.5 font-semibold">Ημ. Λήξης</th>
                        <th className="px-3 py-2.5 font-semibold">Κατάσταση</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Ενέργεια</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agreementVersions.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                            Καμία συμφωνία — πάτα «Νέα Συμφωνία» για το πρώτο πακέτο.
                          </td>
                        </tr>
                      ) : (
                        agreementVersions.map((row) => {
                          const active = isAgreementActive(row)
                          return (
                            <tr key={row.id} className="border-b border-white/5 hover:bg-slate-800/40">
                              <td className="px-4 py-2.5 text-white">
                                {row.start_date
                                  ? new Date(row.start_date).toLocaleDateString('el-GR')
                                  : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-slate-300">
                                {row.end_date
                                  ? new Date(row.end_date).toLocaleDateString('el-GR')
                                  : '—'}
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className={
                                    active
                                      ? 'rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-100'
                                      : 'rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-slate-400'
                                  }
                                >
                                  {agreementStatusLabel(row)}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => openViewAgreement(row)}
                                  className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
                                >
                                  Προβολή
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
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
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  value={toElInputDisplay(paymentForm.amount)}
                  onChange={(e) => patchPayment('amount', fromElInputValue(e.target.value))}
                  disabled={paymentsMissing || paymentsSaving}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Τύπος πληρωμής
                </label>
                <DarkSelect
                  value={paymentForm.payment_type}
                  onChange={(v) => patchPayment('payment_type', v)}
                  disabled={paymentsMissing || paymentsSaving}
                  options={PAYMENT_TYPES.map((t) => ({
                    value: t.value,
                    label: t.label,
                  }))}
                  className="mt-1 w-full"
                />
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
                  <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">Ημερομηνία</th>
                        <th className="whitespace-nowrap px-3 py-2.5 font-semibold">Τύπος</th>
                        <th className="whitespace-nowrap px-2 py-2.5 font-semibold">Μήνας</th>
                        <th className="whitespace-nowrap px-2 py-2.5 font-semibold">Έτος</th>
                        <th className="min-w-[140px] px-3 py-2.5 font-semibold">Περιγραφή</th>
                        <th className="whitespace-nowrap px-2 py-2.5 text-right font-semibold">
                          Μισθός Πιστ.
                        </th>
                        <th className="whitespace-nowrap px-2 py-2.5 text-right font-semibold">
                          Λοιπά Πιστ.
                        </th>
                        <th className="whitespace-nowrap px-2 py-2.5 text-right font-semibold">
                          Τιμολόγιο Πιστ.
                        </th>
                        <th className="whitespace-nowrap px-3 py-2.5 text-center font-semibold">
                          Ενέργειες
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentsDisplayList.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                            Δεν υπάρχουν πληρωμές ακόμα.
                          </td>
                        </tr>
                      ) : (
                        paymentsDisplayList.map((row) => {
                          const monthNum = Number(row.month)
                          const monthLabel =
                            monthNum >= 1 && monthNum <= 12
                              ? MONTH_SHORT[monthNum - 1]
                              : '—'
                          const typeLabel =
                            Number(row.type_id) === 95 ||
                            String(row.notes || '').startsWith('Εκταμίευση Δανείου')
                              ? 'Εκταμίευση Δανείου'
                              : paymentTypeLabel(row.payment_type || row.entry_type)
                          return (
                            <tr
                              key={row.id}
                              className="border-b border-white/5 hover:bg-slate-800/40"
                            >
                              <td className="whitespace-nowrap px-3 py-2.5 text-slate-200">
                                {row.payment_date
                                  ? new Date(row.payment_date).toLocaleDateString('el-GR')
                                  : '—'}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-semibold text-slate-200">
                                  {typeLabel}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-slate-300">
                                {monthLabel}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 tabular-nums text-slate-300">
                                {row.year != null && row.year !== '' ? row.year : '—'}
                              </td>
                              <td
                                className="max-w-[220px] truncate px-3 py-2.5 text-slate-400"
                                title={row.notes || row.description || ''}
                              >
                                {row.notes || row.description || '—'}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono text-sm text-cyan-100/90">
                                {formatPaymentCredit(row.salary_credit)}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono text-sm text-cyan-100/90">
                                {formatPaymentCredit(row.other_credit)}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono text-sm text-cyan-100/90">
                                {formatPaymentCredit(row.invoice_credit)}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeletePayment(row)}
                                  title="Διαγραφή πληρωμής"
                                  className="inline-flex items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-200 transition hover:border-rose-400/50 hover:bg-rose-500/20"
                                >
                                  <svg
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    className="h-4 w-4"
                                    aria-hidden
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193v-.443A2.75 2.75 0 0011.25 1h-2.5zM10 4c.784 0 1.532.022 2.235.064V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.314A41.65 41.65 0 0110 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                  <span className="sr-only">Διαγραφή</span>
                                </button>
                              </td>
                            </tr>
                          )
                        })
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
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Αναλυτικές Κινήσεις · {MONTH_LABELS[selectedMonth - 1]} {analysisYear}
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  {isOfficeEmployee
                    ? `Ώρες γραφείου · ΕΤΑΙΡΙΑ · ${displayName || tech.name}`
                    : `Ημερήσια λίστα για ${tech.name}`}
                </p>
              </div>
              {isOfficeEmployee ? (
                <button
                  type="button"
                  onClick={handleSaveWorkHours}
                  disabled={workHoursSaving || workHoursLoading || workHoursMissing}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  {workHoursSaving
                    ? 'Αποθήκευση...'
                    : workHoursDirty
                      ? 'Αποθήκευση Ωρών *'
                      : 'Αποθήκευση Ωρών'}
                </button>
              ) : null}
            </div>

            {isOfficeEmployee && workHoursMissing ? (
              <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
                Λείπει ο πίνακας <code className="rounded bg-black/30 px-1">work_hours</code>. Τρέξε{' '}
                <code className="rounded bg-black/30 px-1">supabase/19_work_hours.sql</code> στο DIAS.
              </div>
            ) : null}
            {isOfficeEmployee && workHoursError && !workHoursMissing ? (
              <div className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
                {workHoursError}
              </div>
            ) : null}

            <div className="overflow-x-auto">
              {isOfficeEmployee ? (
                <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-slate-950/60 text-xs uppercase tracking-wider text-slate-400">
                      <th className="whitespace-nowrap px-3 py-3 font-semibold">Ημέρα</th>
                      <th className="whitespace-nowrap px-3 py-3 font-semibold">Ημερομηνία</th>
                      <th className="px-3 py-3 font-semibold">Έργο / Κατάσταση</th>
                      <th className="whitespace-nowrap px-3 py-3 font-semibold">Ώρες</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Υπερωρίες</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Νυχτερινά</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Αργίες</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Σύνολο</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workHoursLoading ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                          Φόρτωση ωρών γραφείου...
                        </td>
                      </tr>
                    ) : (
                      officeDayList.map((dateIso) => {
                        const day = manualHours[dateIso] || emptyManualDay()
                        const buckets =
                          isValidTimeHHMM(day.time_start) && isValidTimeHHMM(day.time_end)
                            ? globalCalcHours(dateIso, day.time_start, day.time_end, {
                                otThreshold: officeOtThreshold,
                              })
                            : { overtime: 0, night: 0, holiday: 0, total: 0 }
                        return (
                          <tr
                            key={dateIso}
                            className="border-b border-white/5 transition hover:bg-white/5"
                          >
                            <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-200">
                              {greekWeekdayLong(dateIso)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-cyan-100/90">
                              {isoDateToGreek(dateIso)}
                            </td>
                            <td className="px-3 py-2.5 text-white">ΕΤΑΙΡΙΑ</td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="00:00"
                                  maxLength={5}
                                  autoComplete="off"
                                  value={day.time_start || ''}
                                  onChange={(e) =>
                                    patchManualTime(dateIso, 'time_start', e.target.value)
                                  }
                                  onBlur={(e) =>
                                    blurManualTime(dateIso, 'time_start', e.target.value)
                                  }
                                  disabled={workHoursMissing}
                                  className="w-[4.5rem] rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-center font-mono text-xs text-white disabled:opacity-50"
                                />
                                <span className="text-slate-500">–</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="00:00"
                                  maxLength={5}
                                  autoComplete="off"
                                  value={day.time_end || ''}
                                  onChange={(e) =>
                                    patchManualTime(dateIso, 'time_end', e.target.value)
                                  }
                                  onBlur={(e) =>
                                    blurManualTime(dateIso, 'time_end', e.target.value)
                                  }
                                  disabled={workHoursMissing}
                                  className="w-[4.5rem] rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-center font-mono text-xs text-white disabled:opacity-50"
                                />
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-amber-200/90">
                              {formatHoursDash(buckets.overtime)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-violet-200/90">
                              {formatHoursDash(buckets.night)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-emerald-200/90">
                              {formatHoursDash(buckets.holiday)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-slate-200">
                              {day.worked_hours > 0
                                ? formatElNumber(day.worked_hours, {
                                    minimumFractionDigits: 1,
                                    maximumFractionDigits: 1,
                                  })
                                : '—'}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-slate-950/60 text-xs uppercase tracking-wider text-slate-400">
                      <th className="whitespace-nowrap px-3 py-3 font-semibold">Ημέρα</th>
                      <th className="whitespace-nowrap px-3 py-3 font-semibold">Ημερομηνία</th>
                      <th className="px-3 py-3 font-semibold">Έργο / Κατάσταση</th>
                      <th className="whitespace-nowrap px-3 py-3 font-semibold">Φάση</th>
                      <th className="whitespace-nowrap px-3 py-3 font-semibold">Ώρες</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Υπερωρίες</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Νυχτερινά</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Αργίες</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Σύνολο</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                          Φόρτωση κινήσεων...
                        </td>
                      </tr>
                    ) : movements.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                          Δεν βρέθηκαν κινήσεις για τον επιλεγμένο μήνα.
                        </td>
                      </tr>
                    ) : (
                      movements.map((row, idx) => {
                        const sameDayAsPrev =
                          idx > 0 && movements[idx - 1]?.dateIso === row.dateIso
                        return (
                        <tr
                          key={`${row.dateIso}-${row.jobOrStatus}-${row.timeStart}-${idx}`}
                          className="border-b border-white/5 transition hover:bg-white/5"
                        >
                          <td className="whitespace-nowrap px-3 py-2.5 text-sm text-slate-200">
                            {sameDayAsPrev ? '' : greekWeekdayLong(row.dateIso)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-cyan-100/90">
                            {sameDayAsPrev ? '' : isoDateToGreek(row.dateIso)}
                          </td>
                          <td className="max-w-[220px] truncate px-3 py-2.5 text-white">
                            {row.jobOrStatus}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-slate-400">
                            {row.phase || '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-slate-300">
                            {row.timeStart && row.timeEnd && row.timeStart !== '-'
                              ? `${row.timeStart} – ${row.timeEnd}`
                              : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-amber-200/90">
                            {formatHoursDash(row.overtime)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-violet-200/90">
                            {formatHoursDash(row.nightHours)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-emerald-200/90">
                            {formatHoursDash(row.weekendHolidayHours)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-slate-200">
                            {formatHoursDash(row.workedHours)}
                          </td>
                        </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="relative flex flex-wrap items-center gap-2 border-t border-white/10 bg-slate-950/70 px-4 py-3 backdrop-blur-md">
        {!showTemporaryToolbar ? (
          <>
            <ActionButton
              tone="slate"
              disabled={hoursTransferSaving || loading || !tech}
              onClick={handleTransferHours}
            >
              {hoursTransferSaving ? 'Μεταφορά...' : 'Μεταφορά Ωρών'}
            </ActionButton>
            <ActionButton
              tone="slate"
              onClick={() => toast('Εκτύπωση — σύντομα', { icon: 'ℹ️' })}
            >
              Εκτύπωση
            </ActionButton>
            <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />
          </>
        ) : null}
        <div className="ml-auto">
          <ActionButton tone="emerald" disabled={saving || loading} onClick={handleSave}>
            {saving ? 'Αποθήκευση...' : 'Οριστική Αποθήκευση ERP'}
          </ActionButton>
        </div>
      </div>
    </div>
  )


  const agreementViewForm = agreementViewRow
    ? snapshotToForm(agreementViewRow.earnings_snapshot)
    : emptyEarningsForm()

  const agreementModals = (
    <>
      {agreementEditorOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
          <button
            type="button"
            aria-label="Κλείσιμο"
            className="absolute inset-0 bg-slate-950/60"
            onClick={() => !agreementsSaving && setAgreementEditorOpen(false)}
          />
          <div className="relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl">
            <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Νέα Συμφωνία</h3>
                <p className="text-xs text-slate-400">
                  Κλείνει την προηγούμενη ενεργή και συγχρονίζει το Mirror Αποδοχών.
                </p>
              </div>
              <div className="w-44">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Ημ. Έναρξης
                </label>
                <GreekDateInput
                  value={agreementStartDate}
                  onChange={setAgreementStartDate}
                  withPicker
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <EarningsPackageForm
                form={agreementDraftForm}
                editMode="full"
                issuesInvoice={issuesInvoice}
                tech={tech}
                onPatchField={patchAgreementDraft}
                onPatchAutoTransfer={patchAgreementDraftAuto}
                onPatchFixedExpense={patchAgreementDraftFixed}
              />
            </div>
            <div className="flex shrink-0 justify-between gap-2 border-t border-white/10 px-4 py-3">
              <button
                type="button"
                disabled={agreementsSaving}
                onClick={() => setAgreementEditorOpen(false)}
                className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-200"
              >
                Ακύρωση
              </button>
              <button
                type="button"
                disabled={agreementsSaving || !tech}
                onClick={handleSaveNewAgreement}
                className="rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-sm font-bold text-emerald-100 disabled:opacity-50"
              >
                {agreementsSaving ? 'Αποθήκευση...' : 'Αποθήκευση συμφωνίας'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {agreementViewOpen && agreementViewRow ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
          <button
            type="button"
            aria-label="Κλείσιμο"
            className="absolute inset-0 bg-slate-950/60"
            onClick={() => setAgreementViewOpen(false)}
          />
          <div className="relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Προβολή συμφωνίας</h3>
                <p className="text-xs text-slate-400">
                  {agreementViewRow.start_date
                    ? new Date(agreementViewRow.start_date).toLocaleDateString('el-GR')
                    : '—'}
                  {' → '}
                  {agreementViewRow.end_date
                    ? new Date(agreementViewRow.end_date).toLocaleDateString('el-GR')
                    : 'ενεργή'}
                  {' · '}
                  {agreementStatusLabel(agreementViewRow)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAgreementViewOpen(false)}
                className="rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-sm font-semibold text-slate-200"
              >
                Κλείσιμο
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <EarningsPackageForm
                form={agreementViewForm}
                editMode="none"
                issuesInvoice={issuesInvoice}
                tech={tech}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )


    const content = embedded ? (
    <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden md:flex-row md:items-stretch">
      <div className="relative flex h-auto max-h-56 min-h-0 shrink-0 flex-col overflow-hidden md:h-full md:max-h-full">
        {techSidebar}
        {usePersonnelSidebar && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Αλλαγή πλάτους λίστας προσωπικού"
            title="Σύρε για αλλαγή πλάτους"
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
              e.stopPropagation()
              sidebarResizeRef.current = {
                startX: e.clientX,
                startWidth: sidebarWidth,
              }
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
            className="absolute inset-y-2 -right-1 z-30 hidden w-2 cursor-col-resize touch-none md:block"
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/15 transition hover:bg-cyan-400/60" />
          </div>
        )}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto md:pl-2">{mainPanel}</div>
    </div>
  ) : (
    mainPanel
  )

  if (embedded) {
    return (
      <>
        {content}
        {agreementModals}
      </>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Κλείσιμο"
        className="absolute inset-0 bg-slate-950/20 backdrop-blur-none"
        onClick={onClose}
      />
      <div
        className="relative flex max-h-[94vh] w-full max-w-[1920px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 shadow-2xl"
        style={analysisPanelStyle}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          aria-hidden
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(34,211,238,0.15), transparent 40%), radial-gradient(circle at 80% 70%, rgba(99,102,241,0.2), transparent 45%)',
          }}
        />
        {content}
        {agreementModals}
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

function MatrixRow({ label, hint, values, total, selectedMonth, onSelectMonth }) {
  const activeMonth = Number(selectedMonth)
  return (
    <tr className="border-b border-white/5">
      <td className="sticky left-0 bg-slate-900/95 px-3 py-2 font-bold text-cyan-200">
        <span title={hint}>{label}</span>
        <span className="ml-1 text-[10px] font-normal text-slate-500">{hint}</span>
      </td>
      {values.map((value, i) => {
        const monthNum = i + 1
        const isActive = activeMonth === monthNum
        return (
        <td
          key={`${label}-${monthNum}`}
          aria-selected={isActive}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelectMonth?.(monthNum)
          }}
          className={`cursor-pointer px-2 py-2 text-center font-mono text-[11px] transition hover:bg-white/5 ${
            isActive
              ? 'bg-amber-400/25 font-semibold text-amber-100'
              : 'bg-transparent text-slate-300'
          }`}
        >
          {value || '·'}
        </td>
        )
      })}
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
