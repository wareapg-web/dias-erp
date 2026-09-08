import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
import PersonnelPanel from './components/PersonnelPanel'
import AdminLoginScreen from './components/AdminLoginScreen'
import ErpWindow from './components/ErpWindow'
import {
  loadModalSize,
  saveModalSize,
  PERSONNEL_CATALOG_MODAL_SIZE_KEY,
} from './lib/modalSize'
import { useDraggableModal, MODAL_POS_KEYS } from './lib/useDraggableModal'

const CATALOG_MODAL_MIN_W = 480
const CATALOG_MODAL_MIN_H = 320

function defaultCatalogModalSize() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    width: Math.min(1024, Math.max(CATALOG_MODAL_MIN_W, vw - 32)),
    height: Math.min(Math.round(vh * 0.72), Math.max(CATALOG_MODAL_MIN_H, vh - 32)),
  }
}

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
  const [personnelModalOpen, setPersonnelModalOpen] = useState(false)
  const [catalogSize, setCatalogSize] = useState(() =>
    loadModalSize(PERSONNEL_CATALOG_MODAL_SIZE_KEY, () => null)
  )
  const catalogResizeRef = useRef(null)
  const catalogFrameRef = useRef(null)
  const [adminSession, setAdminSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const {
    panelStyle: catalogPanelStyle,
    dragHandleProps: catalogDragHandleProps,
    dragHandleClassName: catalogDragHandleClassName,
  } = useDraggableModal(personnelModalOpen, MODAL_POS_KEYS.personnelCatalog)
  const {
    panelStyle: settingsPanelStyle,
    dragHandleProps: settingsDragHandleProps,
    dragHandleClassName: settingsDragHandleClassName,
  } = useDraggableModal(settingsOpen, MODAL_POS_KEYS.settings)

  const period = formatPeriod(selectedYear, selectedMonth)

  useEffect(() => {
    if (catalogSize) saveModalSize(PERSONNEL_CATALOG_MODAL_SIZE_KEY, catalogSize)
  }, [catalogSize])

  useEffect(() => {
    const onMove = (e) => {
      const d = catalogResizeRef.current
      if (!d) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      const vw = window.innerWidth
      const vh = window.innerHeight
      let { width, height } = d.orig
      const edge = d.edge
      if (edge.includes('e')) width = d.orig.width + dx
      if (edge.includes('s')) height = d.orig.height + dy
      if (edge.includes('w')) width = d.orig.width - dx
      if (edge.includes('n')) height = d.orig.height - dy
      width = Math.min(Math.max(width, CATALOG_MODAL_MIN_W), vw - 24)
      height = Math.min(Math.max(height, CATALOG_MODAL_MIN_H), vh - 24)
      setCatalogSize({ width, height })
    }
    const onUp = () => {
      catalogResizeRef.current = null
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

  const startCatalogResize = useCallback(
    (edge) => (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const rect = catalogFrameRef.current?.getBoundingClientRect()
      const orig = catalogSize || {
        width: rect?.width || defaultCatalogModalSize().width,
        height: rect?.height || defaultCatalogModalSize().height,
      }
      catalogResizeRef.current = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        orig,
      }
    },
    [catalogSize]
  )

  const catalogResizeHandle = (edge, cursor, extra = '') => (
    <div
      role="presentation"
      onPointerDown={startCatalogResize(edge)}
      className={`absolute z-30 ${extra}`}
      style={{ cursor }}
    />
  )

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
      diasClient.from('personnel').select('*').order('position_number', { ascending: true }),
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
    const pickDefault = () =>
      personnel.find((p) => p.is_active !== false && p.employment_type === 'permanent') ||
      personnel.find((p) => p.is_active !== false) ||
      personnel[0]

    if (!selectedPerson) {
      const first =
        listFilter === 'dismissed'
          ? personnel.find((p) => p.is_active === false)
          : listFilter === 'temporary'
            ? personnel.find((p) => p.employment_type === 'temporary' && p.is_active !== false)
            : pickDefault()
      if (first) setSelectedPerson(first)
      return
    }
    if (!personnel.some((p) => p.id === selectedPerson.id)) {
      setSelectedPerson(pickDefault())
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
        const period = formatPeriod(year, month)
        const techId = rest.tech_id != null ? String(rest.tech_id) : null

        // Ένα record ανά υπάλληλο + μήνα: σβήσε παλιές εγγραφές, μετά insert
        if (techId) {
          const { error: deleteError } = await diasClient
            .from('payrolls')
            .delete()
            .eq('tech_id', techId)
            .eq('period', period)
          if (deleteError) {
            const message = formatSupabaseError(deleteError, {
              table: 'payrolls',
              clientLabel: 'DIAS ERP',
            })
            if (isMissingTableError(deleteError)) setPayrollsMissing(true)
            setError(message)
            throw deleteError
          }
        }

        const { error: saveError } = await diasClient.from('payrolls').insert({
          ...rest,
          tech_id: techId,
          period,
          year: Number(year),
          month: Number(month),
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
        storageKey="dias-erp:modal-pos:main-window"
        titleBar={
          <div className="flex w-full min-w-0 items-center gap-3 pr-2">
            <div className="min-w-0 shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400/80">
                DIAS ERP · Λογιστήριο
              </p>
              <h1 className="truncate bg-gradient-to-r from-white to-cyan-200 bg-clip-text text-lg font-bold text-transparent md:text-xl">
                Οικονομικά Στοιχεία Προσωπικού
              </h1>
            </div>
            <div className="flex flex-1 justify-center px-2">
              <button
                type="button"
                onClick={() => setPersonnelModalOpen(true)}
                className="rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-1.5 text-xs font-bold text-cyan-100 transition hover:bg-cyan-500/25 md:px-5 md:text-sm"
              >
                Υπάλληλοι
              </button>
            </div>
            <button
              type="button"
              onClick={async () => {
                await adminClient.auth.signOut()
              }}
              className="shrink-0 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-100 transition hover:bg-rose-500/25"
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
            initialMonth={selectedMonth}
            initialYear={selectedYear}
            saving={saving || loading}
            payrolls={payrolls}
            onSaveToErp={savePayrollToErp}
          />
        </div>
      </ErpWindow>

      {personnelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/20 backdrop-blur-none"
            aria-label="Κλείσιμο"
            onClick={() => setPersonnelModalOpen(false)}
          />
          <div
            ref={catalogFrameRef}
            className={`relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur-md ${
              catalogSize ? '' : 'h-fit max-h-[85vh] w-full max-w-5xl'
            }`}
            style={
              catalogSize
                ? {
                    width: catalogSize.width,
                    height: catalogSize.height,
                    maxWidth: 'calc(100vw - 1.5rem)',
                    maxHeight: 'min(85vh, calc(100vh - 1.5rem))',
                    ...catalogPanelStyle,
                  }
                : { ...catalogPanelStyle }
            }
          >
            {catalogResizeHandle('n', 'ns-resize', 'left-2 right-2 top-0 h-2')}
            {catalogResizeHandle('s', 'ns-resize', 'left-2 right-2 bottom-0 h-2')}
            {catalogResizeHandle('e', 'ew-resize', 'top-2 bottom-2 right-0 w-2')}
            {catalogResizeHandle('w', 'ew-resize', 'top-2 bottom-2 left-0 w-2')}
            {catalogResizeHandle('nw', 'nwse-resize', 'left-0 top-0 h-3 w-3')}
            {catalogResizeHandle('ne', 'nesw-resize', 'right-0 top-0 h-3 w-3')}
            {catalogResizeHandle('sw', 'nesw-resize', 'bottom-0 left-0 h-3 w-3')}
            {catalogResizeHandle('se', 'nwse-resize', 'bottom-0 right-0 h-4 w-4')}

            <div
              className={`flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3 ${catalogDragHandleClassName}`}
              {...catalogDragHandleProps}
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
                  Προσωπικο DIAS
                </p>
                <h2 className="text-lg font-bold text-white">Κατάλογος υπαλλήλων</h2>
              </div>
              <button
                type="button"
                onClick={() => setPersonnelModalOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Κλείσιμο
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
              <PersonnelPanel
                variant="catalog"
                inModal
                personnel={personnel}
                adminTechs={techs}
                selectedId={selectedPerson?.id || null}
                onSelect={setSelectedPerson}
                onMutated={handlePersonnelMutated}
                listFilter={listFilter}
                onListFilterChange={setListFilter}
                typeFilter={typeFilter}
                onTypeFilterChange={setTypeFilter}
              />
            </div>

            <div
              className="pointer-events-none absolute bottom-1.5 right-1.5 z-10 h-3 w-3 border-b-2 border-r-2 border-cyan-400/50"
              aria-hidden
            />
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/20 backdrop-blur-none"
            aria-label="Κλείσιμο"
            onClick={() => setSettingsOpen(false)}
          />
          <div
            className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md"
            style={settingsPanelStyle}
          >
            <div className={settingsDragHandleClassName} {...settingsDragHandleProps}>
              <h3 className="text-lg font-bold text-white">Γενικές Παράμετροι</h3>
              <p className="mt-2 text-sm text-slate-400">
                Οι παράμετροι μισθοδοσίας του DIAS ERP θα ρυθμίζονται εδώ.
              </p>
            </div>
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
