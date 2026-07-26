import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  adminClient,
  diasClient,
  fetchAllRows,
  formatSupabaseError,
  isMissingTableError,
  safeQuery,
} from './lib/supabase'
import { mapTechRow } from './lib/crewPayroll'
import { personnelAsTech, personnelFromDb } from './lib/personnel'
import TechAnalysisModal from './components/TechAnalysisModal'
import AdminLoginScreen from './components/AdminLoginScreen'
import ErpWindow from './components/ErpWindow'

function formatPeriod(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

export default function App() {
  const now = new Date()
  const [techs, setTechs] = useState([])
  const [personnel, setPersonnel] = useState([])
  const [payrolls, setPayrolls] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [payrollsMissing, setPayrollsMissing] = useState(false)
  const [personnelMissing, setPersonnelMissing] = useState(false)
  const [personnelError, setPersonnelError] = useState(null)

  const [selectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear] = useState(now.getFullYear())
  const [saving, setSaving] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [listFilter, setListFilter] = useState('active')
  const [typeFilter, setTypeFilter] = useState('all')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminSession, setAdminSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

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
    const result = await safeQuery(
      diasClient.from('payrolls').select('*').order('created_at', { ascending: false }),
      { table: 'payrolls', clientLabel: 'DIAS ERP' }
    )
    setPayrolls(result.data || [])
    setPayrollsMissing(result.missing)
  }, [])

  const loadPersonnel = useCallback(async () => {
    setPersonnelError(null)
    const result = await safeQuery(
      diasClient.from('personnel').select('*').order('tech_name', { ascending: true }),
      { table: 'personnel', clientLabel: 'DIAS ERP' }
    )
    const rows = (result.data || []).map(personnelFromDb)
    setPersonnel(rows)
    setPersonnelMissing(result.missing)
    if (result.error) setPersonnelError(result.error)
    return rows
  }, [])

  const loadAdminTechs = useCallback(async () => {
    if (!adminSession) return
    setLoading(true)
    setError(null)
    try {
      const techsRaw = await fetchAllRows(adminClient, 'techs')
      setTechs(techsRaw.map(mapTechRow))
    } catch (err) {
      setError(formatSupabaseError(err, { clientLabel: 'Admin App' }))
      setTechs([])
    } finally {
      setLoading(false)
    }
  }, [adminSession])

  useEffect(() => {
    if (!adminSession) return
    loadAdminTechs()
    loadPersonnel()
    loadPayrolls()
  }, [adminSession, loadAdminTechs, loadPersonnel, loadPayrolls])

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

  const handlePersonnelMutated = useCallback(async () => {
    const rows = await loadPersonnel()
    if (selectedPerson?.id) {
      const next = rows.find((p) => p.id === selectedPerson.id)
      if (next) setSelectedPerson(next)
      else if (rows.length) setSelectedPerson(rows.find((p) => p.is_active !== false) || rows[0])
      else setSelectedPerson(null)
    }
  }, [loadPersonnel, selectedPerson?.id])

  useEffect(() => {
    if (!personnel.length) {
      if (selectedPerson) setSelectedPerson(null)
      return
    }
    if (!selectedPerson) {
      const first =
        listFilter === 'archive'
          ? personnel.find((p) => p.is_active === false)
          : personnel.find((p) => p.is_active !== false) || personnel[0]
      if (first) setSelectedPerson(first)
      return
    }
    if (!personnel.some((p) => p.id === selectedPerson.id)) {
      setSelectedPerson(personnel.find((p) => p.is_active !== false) || personnel[0])
    }
  }, [personnel, selectedPerson, listFilter])

  const analysisTech = useMemo(
    () => personnelAsTech(selectedPerson, techs),
    [selectedPerson, techs]
  )

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
          {(error || personnelError || personnelMissing) && (
            <div className="mb-3 shrink-0 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {personnelMissing
                ? 'Λείπει ο πίνακας personnel στο DIAS — τρέξε supabase/01_dias_bootstrap.sql και 02_personnel_hr.sql.'
                : error || personnelError}
            </div>
          )}
          <TechAnalysisModal
            embedded
            tech={analysisTech}
            adminTechs={techs}
            personnel={personnel}
            selectedPersonId={selectedPerson?.id || null}
            onPersonSelect={setSelectedPerson}
            onPersonnelMutated={handlePersonnelMutated}
            listFilter={listFilter}
            onListFilterChange={setListFilter}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            initialMonth={selectedMonth}
            initialYear={selectedYear}
            saving={saving || loading}
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
              Οι παράμετροι μισθοδοσίας του DIAS ERP θα ρυθμίζονται εδώ.
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
