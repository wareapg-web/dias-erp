import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  adminClient,
  diasClient,
  fetchAllRows,
  formatSupabaseError,
  isMissingTableError,
  safeQuery,
} from './lib/supabase'
import {
  buildMonthlyPayroll,
  mapAssignmentRow,
  mapDailyStatusRow,
  mapJobRow,
  mapTechRow,
  payrollTechs,
} from './lib/crewPayroll'
import TechAnalysisModal from './components/TechAnalysisModal'
import AdminLoginScreen from './components/AdminLoginScreen'
import ErpWindow from './components/ErpWindow'

const MONTHS = [
  'Ιανουάριος',
  'Φεβρουάριος',
  'Μάρτιος',
  'Απρίλιος',
  'Μάιος',
  'Ιούνιος',
  'Ιούλιος',
  'Αύγουστος',
  'Σεπτέμβριος',
  'Οκτώβριος',
  'Νοέμβριος',
  'Δεκέμβριος',
]

const ALL_TECHS = 'Όλοι'

function formatPeriod(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function exportMovementsCsv(rows, month, year) {
  const header = [
    'Ημερομηνία',
    'Τεχνικός',
    'Έργο/Κατάσταση',
    'Φάση',
    'Ώρες',
    'Σύνολο ωρών',
    'Νυχτερινά',
    'Υπερωρίες',
    'Αργίες/ΣΚ',
  ]
  const lines = [
    header.join(';'),
    ...rows.map((r) =>
      [
        r.dateIso,
        r.tech,
        `"${String(r.jobOrStatus || '').replace(/"/g, '""')}"`,
        r.phase,
        r.timeStart && r.timeEnd && r.timeStart !== '-'
          ? `${r.timeStart} – ${r.timeEnd}`
          : '',
        r.workedHours ?? '',
        r.nightHours ?? '',
        r.overtime ?? '',
        r.weekendHolidayHours ?? '',
      ].join(';')
    ),
  ]
  const blob = new Blob(['\ufeff' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `misthodosia_${year}-${String(month).padStart(2, '0')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const now = new Date()
  const [techs, setTechs] = useState([])
  const [jobs, setJobs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [dailyStatus, setDailyStatus] = useState([])
  const [payrolls, setPayrolls] = useState([])

  const [loading, setLoading] = useState(true)
  const [payrollsLoading, setPayrollsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [payrollsError, setPayrollsError] = useState(null)
  const [payrollsMissing, setPayrollsMissing] = useState(false)

  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [techFilter, setTechFilter] = useState(ALL_TECHS)
  const [saving, setSaving] = useState(false)
  const [analysisTech, setAnalysisTech] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminSession, setAdminSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [dataStats, setDataStats] = useState({ assignments: 0, dailyStatus: 0, jobs: 0 })

  const period = formatPeriod(selectedYear, selectedMonth)

  useEffect(() => {
    let mounted = true
    adminClient.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setAdminSession(data.session)
      setAuthLoading(false)
    })
    const { data: sub } = adminClient.auth.onAuthStateChange((_event, session) => {
      setAdminSession(session)
      setAuthLoading(false)
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const loadPayrolls = useCallback(async () => {
    setPayrollsLoading(true)
    setPayrollsError(null)

    const result = await safeQuery(
      diasClient.from('payrolls').select('*').order('created_at', { ascending: false }),
      { table: 'payrolls', clientLabel: 'DIAS ERP' }
    )

    setPayrolls(result.data)
    setPayrollsMissing(result.missing)
    setPayrollsError(result.error)
    setPayrollsLoading(false)
  }, [])

  const loadAdminData = useCallback(async () => {
    if (!adminSession) return

    setLoading(true)
    setError(null)
    setWarnings([])

    const pad = (n) => String(n).padStart(2, '0')
    const prevMonthDate = new Date(selectedYear, selectedMonth - 1, 0)
    const from = `${prevMonthDate.getFullYear()}-${pad(prevMonthDate.getMonth() + 1)}-${pad(prevMonthDate.getDate())}`
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate()
    const to = `${selectedYear}-${pad(selectedMonth)}-${pad(lastDay)}`

    const dateFilter = (q) => q.gte('date_iso', from).lte('date_iso', to)

    try {
      const [techsRaw, jobsRaw, assignmentsRaw, statusRaw] = await Promise.all([
        fetchAllRows(adminClient, 'techs'),
        fetchAllRows(adminClient, 'jobs'),
        fetchAllRows(adminClient, 'assignments', dateFilter),
        fetchAllRows(adminClient, 'daily_status', dateFilter),
      ])

      setTechs(techsRaw.map(mapTechRow))
      setJobs(jobsRaw.map(mapJobRow))
      setAssignments(assignmentsRaw.map(mapAssignmentRow))
      setDailyStatus(statusRaw.map(mapDailyStatusRow))
      setDataStats({
        assignments: assignmentsRaw.length,
        dailyStatus: statusRaw.length,
        jobs: jobsRaw.length,
      })
    } catch (err) {
      setError(formatSupabaseError(err, { clientLabel: 'Admin App' }))
      setTechs([])
      setJobs([])
      setAssignments([])
      setDailyStatus([])
      setDataStats({ assignments: 0, dailyStatus: 0, jobs: 0 })
    } finally {
      setLoading(false)
    }
  }, [selectedMonth, selectedYear, adminSession])

  useEffect(() => {
    if (!adminSession) return
    loadAdminData()
  }, [loadAdminData, adminSession])

  useEffect(() => {
    loadPayrolls()
  }, [loadPayrolls])

  useEffect(() => {
    if (payrollsMissing) return undefined

    const channel = diasClient
      .channel('payrolls-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payrolls' },
        () => {
          loadPayrolls()
        }
      )
      .subscribe()

    return () => {
      diasClient.removeChannel(channel)
    }
  }, [loadPayrolls, payrollsMissing])

  const savePayrollToErp = useCallback(
    async (payrollRecord = {}) => {
      try {
        setSaving(true)
        setError(null)

        const month = payrollRecord.month ?? selectedMonth
        const year = payrollRecord.year ?? selectedYear
        const { month: _m, year: _y, ...rest } = payrollRecord

        const { error: saveError } = await diasClient.from('payrolls').insert({
          ...rest,
          period: formatPeriod(year, month),
        })

        if (saveError) {
          const message = formatSupabaseError(saveError, {
            table: 'payrolls',
            clientLabel: 'DIAS ERP',
          })
          if (isMissingTableError(saveError)) {
            setPayrollsMissing(true)
            setPayrollsError(message)
          }
          setError(message)
          throw saveError
        }

        await loadPayrolls()
      } catch (err) {
        if (!isMissingTableError(err)) {
          setError(formatSupabaseError(err, { table: 'payrolls', clientLabel: 'DIAS ERP' }))
        }
        throw err
      } finally {
        setSaving(false)
      }
    },
    [selectedMonth, selectedYear, loadPayrolls]
  )

  const activeTechs = useMemo(() => payrollTechs(techs), [techs])

  useEffect(() => {
    if (!analysisTech && activeTechs.length > 0) {
      setAnalysisTech(activeTechs[0])
    } else if (
      analysisTech &&
      activeTechs.length > 0 &&
      !activeTechs.some((t) => t.id === analysisTech.id)
    ) {
      setAnalysisTech(activeTechs[0])
    }
  }, [activeTechs, analysisTech])

  const payrollByTech = useMemo(() => {
    const map = new Map()
    for (const tech of activeTechs) {
      map.set(
        tech.name,
        buildMonthlyPayroll(
          tech,
          selectedYear,
          selectedMonth,
          assignments,
          jobs,
          dailyStatus
        )
      )
    }
    return map
  }, [activeTechs, selectedYear, selectedMonth, assignments, jobs, dailyStatus])

  const summaries = useMemo(() => {
    return activeTechs.map((tech) => {
      const { summary } = payrollByTech.get(tech.name) || {
        summary: {
          tech: tech.name,
          totalHours: 0,
          holidayHours: 0,
          nightHours: 0,
          overtimeHours: 0,
          overnightDays: 0,
          metroDays: 0,
          workDays: 0,
          repoDays: 0,
          leaveDays: 0,
          sickDays: 0,
          weekendBonus: 0,
        },
      }
      return { ...summary, techId: tech.id }
    })
  }, [activeTechs, payrollByTech])

  const filteredSummaries = useMemo(() => {
    if (techFilter === ALL_TECHS) return summaries
    return summaries.filter((s) => s.tech === techFilter)
  }, [summaries, techFilter])

  const heroSummary = filteredSummaries[0] || null

  const movementRows = useMemo(() => {
    const list =
      techFilter === ALL_TECHS
        ? activeTechs
        : activeTechs.filter((t) => t.name === techFilter)

    const rows = []
    for (const tech of list) {
      const { rows: techRows } = payrollByTech.get(tech.name) || { rows: [] }
      rows.push(...techRows)
    }
    rows.sort(
      (a, b) =>
        String(a.dateIso).localeCompare(String(b.dateIso)) ||
        String(a.tech).localeCompare(String(b.tech)) ||
        String(a.timeStart || '').localeCompare(String(b.timeStart || ''))
    )
    return rows
  }, [activeTechs, techFilter, payrollByTech])

  const selectClass =
    'rounded-xl border border-white/10 bg-slate-900/75 px-3 py-2 text-sm font-medium text-white backdrop-blur-md'

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        Έλεγχος σύνδεσης Admin...
      </div>
    )
  }

  if (!adminSession) {
    return <AdminLoginScreen onSignedIn={() => {}} />
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(34,211,238,0.15), transparent 40%), radial-gradient(circle at 80% 70%, rgba(99,102,241,0.2), transparent 45%)',
        }}
      />

      <ErpWindow
        titleBar={
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 pr-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400/80">
                DIAS ERP · Λογιστήριο
              </p>
              <h1 className="truncate bg-gradient-to-r from-white to-cyan-200 bg-clip-text text-lg font-bold text-transparent md:text-xl">
                Οικονομικά Στοιχεία Προσωπικού
              </h1>
            </div>
            <button
              type="button"
              onClick={async () => {
                await adminClient.auth.signOut()
              }}
              className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/25"
            >
              Έξοδος
            </button>
          </div>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 md:p-4">
          <TechAnalysisModal
            embedded
            tech={analysisTech}
            techList={activeTechs}
            onTechChange={setAnalysisTech}
            initialMonth={selectedMonth}
            initialYear={selectedYear}
            saving={saving}
            payrolls={payrolls}
            onSaveToErp={savePayrollToErp}
          />
        </div>
      </ErpWindow>

      {settingsOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            aria-label="Κλείσιμο"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md">
            <h3 className="text-lg font-bold text-white">Γενικές Παράμετροι</h3>
            <p className="mt-2 text-sm text-slate-400">
              Οι παράμετροι μισθοδοσίας του DIAS ERP θα ρυθμίζονται εδώ. Η σύνδεση με τον πίνακα
              ρυθμίσεων θα ενεργοποιηθεί μόλις δημιουργηθεί στο νέο schema.
            </p>
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
              Περίοδος εργασίας: <span className="font-mono text-cyan-300">{period}</span>
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="mt-5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Κλείσιμο
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatChip({ label, value }) {
  return (
    <div className="rounded-xl border border-white/5 bg-slate-950/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-white">{value}</p>
    </div>
  )
}
