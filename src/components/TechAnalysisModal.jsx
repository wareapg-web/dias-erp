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

export default function TechAnalysisModal({
  tech,
  techList,
  onTechChange,
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

  useEffect(() => {
    setAnalysisYear(initialYear)
    setSelectedMonth(initialMonth)
  }, [tech?.id, initialYear, initialMonth])

  useEffect(() => {
    if (!tech) return

    let cancelled = false

    async function loadLegacyData() {
      try {
        setLoading(true)
        setLoadError(null)

        const from = `${analysisYear}-01-01`
        const to = `${analysisYear}-12-31`

        const [assignmentsRes, jobsRes, statusRes] = await Promise.all([
          safeQuery(
            adminClient
              .from('assignments')
              .select('*')
              .eq('tech', tech.name)
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
              .eq('tech', tech.name)
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

  const { lastName, firstName } = tech ? splitTechName(tech.name) : { lastName: '', firstName: '' }
  const photoUrl = tech ? techPhotoUrl(tech) : null
  const hireDate = tech ? techHireDate(tech) : null

  const handleSave = () => {
    if (!tech) return
    const amount =
      selectedSalary?.sigma ||
      estimateAmount(tech, selectedSummary?.workDays ?? 0, selectedSummary?.totalHours ?? 0)
    onSaveToErp?.({
      tech_id: tech.id,
      tech_name: tech.name,
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

  const showMatrix = activeTab === 'analysis'
  const showMovements = activeTab === 'movements'
  const showTechDropdown = !embedded && Array.isArray(techList) && techList.length > 0 && onTechChange
  const innerTabs = [
    { id: 'analysis', label: 'Οικονομική Ανάλυση' },
    { id: 'earnings', label: 'Αποδοχές' },
    { id: 'payments', label: 'Λίστα Πληρωμών' },
    { id: 'movements', label: 'Αναλυτικά στοιχεία' },
  ]

  const techSidebar =
    embedded && onTechChange ? (
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
      Επίλεξε τεχνικό από τη λίστα αριστερά.
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
              <InfoField label="Κωδικός" value={tech.id} />
              <InfoField label="Επώνυμο" value={lastName} />
              <InfoField label="Όνομα" value={firstName} />
              <InfoField label="Πρόσληψη" value={hireDate || '—'} />
            </div>

            <div className="h-20 w-20 shrink-0 self-center overflow-hidden rounded-xl border border-white/10 bg-slate-800 lg:self-auto">
              {photoUrl ? (
                <img src={photoUrl} alt={tech.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-cyan-300/80">
                  {(tech.initials || lastName.slice(0, 2)).toUpperCase()}
                </div>
              )}
            </div>
          </div>
        </div>

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

            {/* Πινακάκι κινήσεων παλιού ERP — layout· λογική ανά κουμπί/tab αργότερα */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
              <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-2xl backdrop-blur-md">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="px-3 py-2.5 font-semibold">Ημερομηνία</th>
                        <th className="px-3 py-2.5 font-semibold">Τύπος</th>
                        <th className="min-w-[180px] px-3 py-2.5 font-semibold">Περιγραφή</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Μισθός Χρ.</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Μισθός Πιστ.</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Λοιπά Χρ.</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Λοιπά Πιστ.</th>
                        <th className="px-3 py-2.5 font-semibold">Notes</th>
                        <th className="px-3 py-2.5 font-semibold">Εισαγωγή</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                          Κενό πινακάκι — η λογική εγγραφών θα συνδεθεί με τις οδηγίες σου.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap gap-3 border-t border-white/10 bg-slate-950/50 px-3 py-2.5">
                  <BalanceChip label="Υπόλοιπο" value={formatEuro(0)} />
                  <BalanceChip label="Υπόλοιπο (1)" value={formatEuro(0)} />
                  <BalanceChip label="Υπόλοιπο (2)" value={formatEuro(0)} />
                  <BalanceChip label="Έξτρα" value={formatEuro(0)} />
                  <BalanceChip label="Τιμολόγιο" value={formatEuro(0)} />
                </div>
              </div>

              <aside className="flex shrink-0 flex-row gap-2 overflow-x-auto lg:w-36 lg:flex-col lg:overflow-visible">
                {[
                  'Εισαγωγή',
                  'Εμφάνιση',
                  'Διαγραφή',
                  'Πληρωμή',
                  'Bonus',
                  'Εξόφληση (1)',
                  'Εξόφληση (2)',
                ].map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => alert(`${label} — σύντομα με τις οδηγίες σου`)}
                    className="shrink-0 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-left text-xs font-semibold text-slate-200 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-100 lg:w-full"
                  >
                    {label}
                  </button>
                ))}
              </aside>
            </div>
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
                        value={earningsForm.bank_account}
                        onChange={(e) => patchEarnings('bank_account', e.target.value)}
                        disabled={earningsMissing}
                        placeholder="π.χ. IBAN"
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600 disabled:opacity-50"
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
                        value={earningsForm.bank_name}
                        onChange={(e) => patchEarnings('bank_name', e.target.value)}
                        disabled={earningsMissing}
                        placeholder="π.χ. EUROBANK"
                        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-600 disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 shadow-xl backdrop-blur-md">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
                    Παραστατικό
                  </p>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={earningsForm.issues_invoice}
                      onChange={(e) => patchEarnings('issues_invoice', e.target.checked)}
                      disabled={earningsMissing}
                      className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-500 focus:ring-cyan-500/40 disabled:opacity-50"
                    />
                    Εκδίδει τιμολόγιο
                  </label>
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
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md">
            <div className="border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Λίστα Πληρωμών</h3>
              <p className="text-xs text-slate-400">
                Ιστορικό πληρωμών / εξοφλήσεων — η λογική θα συνδεθεί με τις οδηγίες σου.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400">
                    <th className="px-3 py-2.5 font-semibold">Ημερομηνία</th>
                    <th className="px-3 py-2.5 font-semibold">Τύπος</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Μήνας</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Έτος</th>
                    <th className="min-w-[140px] px-3 py-2.5 font-semibold">Περιγραφή</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Μισθός Χρ.</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Μισθός Πιστ.</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Λοιπά Χρ.</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Λοιπά Πιστ.</th>
                    <th className="px-3 py-2.5 font-semibold">Notes</th>
                    <th className="px-3 py-2.5 font-semibold">Εισαγωγή</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-sm text-slate-500">
                      Δεν υπάρχουν εγγραφές ακόμα — θα γεμίσει όταν δέσουμε τη λογική πληρωμών.
                    </td>
                  </tr>
                </tbody>
              </table>
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
        <ActionButton tone="slate" onClick={() => alert('Μεταφορά Ωρών — σύντομα')}>
          Μεταφορά Ωρών
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
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
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
