import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { diasClient, formatSupabaseError, isMissingTableError } from '../lib/supabase'
import {
  EMPLOYMENT_TYPES,
  PAYMENT_METHODS,
  MARITAL_STATUSES,
  BANKS,
  buildFullName,
  emptyPersonnelForm,
  employmentLabel,
  paymentMethodLabel,
  personnelFromDb,
  personnelToDb,
  shiftPersonnelPositionsFrom,
} from '../lib/personnel'
import { splitTechName } from '../lib/payrollAnalysis'
import { payrollTechs } from '../lib/crewPayroll'
import { uploadPersonnelPhoto } from '../utils/uploadPhotoToR2'
import {
  greekCapsLabel,
  isoDateToGreek,
  maskGreekDateInput,
  parseToIsoDate,
  positionSortKey,
} from '../lib/greekDate'
import {
  loadModalSize,
  saveModalSize,
  PERSONNEL_FORM_MODAL_SIZE_KEY,
} from '../lib/modalSize'
import {
  addNewPeriod,
  findPeriodOverlapError,
  getLatestPeriod,
  loadPersonnelPeriods,
  mirrorFormDatesFromLatest,
  savePersonnelPeriods,
  sortPeriods,
  syncLatestPeriodFromForm,
} from '../lib/personnelPeriods'

export default function PersonnelPanel({
  variant = 'catalog',
  inModal = false,
  personnel,
  adminTechs,
  selectedId,
  onSelect,
  onMutated,
  listFilter,
  onListFilterChange,
  typeFilter,
  onTypeFilterChange,
}) {
  const isSidebar = variant === 'sidebar'
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyPersonnelForm())
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [editingPeriodId, setEditingPeriodId] = useState(null)
  const photoInputRef = useRef(null)
  const formResizeRef = useRef(null)
  const [formSize, setFormSize] = useState(() =>
    loadModalSize(PERSONNEL_FORM_MODAL_SIZE_KEY, defaultFormModalSize)
  )

  useEffect(() => {
    saveModalSize(PERSONNEL_FORM_MODAL_SIZE_KEY, formSize)
  }, [formSize])

  useEffect(() => {
    const onMove = (e) => {
      const d = formResizeRef.current
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
      width = Math.min(Math.max(width, FORM_MODAL_MIN_W), vw - 24)
      height = Math.min(Math.max(height, FORM_MODAL_MIN_H), vh - 24)
      setFormSize({ width, height })
    }
    const onUp = () => {
      formResizeRef.current = null
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

  const startFormResize = useCallback(
    (edge) => (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      formResizeRef.current = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        orig: { ...formSize },
      }
    },
    [formSize]
  )

  const formResizeHandle = (edge, cursor, extra = '') => (
    <div
      role="presentation"
      onPointerDown={startFormResize(edge)}
      className={`absolute z-30 ${extra}`}
      style={{ cursor }}
    />
  )

  const filtered = useMemo(() => {
    let list = [...(personnel || [])]
    if (isSidebar) {
      list = list.filter((p) => p.is_active !== false && p.employment_type === 'permanent')
    } else {
      if (listFilter === 'active') {
        list = list.filter((p) => p.is_active !== false && p.employment_type !== 'temporary')
      }
      if (listFilter === 'dismissed') list = list.filter((p) => p.is_active === false)
      if (listFilter === 'temporary') {
        list = list.filter((p) => p.employment_type === 'temporary' && p.is_active !== false)
      }
      if (listFilter === 'all' && typeFilter && typeFilter !== 'all') {
        list = list.filter((p) => p.employment_type === typeFilter)
      }
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (p) =>
          String(p.tech_name || '')
            .toLowerCase()
            .includes(q) ||
          String(p.tech_id || '').includes(q) ||
          String(p.code || '').includes(q)
      )
    }
    list.sort((a, b) => {
      const byPos = positionSortKey(a.position_number) - positionSortKey(b.position_number)
      if (byPos !== 0) return byPos
      return String(a.tech_name || '').localeCompare(String(b.tech_name || ''), 'el')
    })
    return list
  }, [personnel, listFilter, typeFilter, search, isSidebar])

  const periodsOverlapError = useMemo(
    () => findPeriodOverlapError(form.periods),
    [form.periods]
  )

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyPersonnelForm())
    setEditingPeriodId(null)
    setError(null)
    setPhotoError(null)
    setFormOpen(true)
  }

  const openEdit = async (person) => {
    setEditingId(person.id)
    setEditingPeriodId(null)
    setError(null)
    setPhotoError(null)
    const base = personnelFromDb(person)
    const periods = await loadPersonnelPeriods(
      person.id,
      base.hire_date,
      base.end_date,
      base.employment_type
    )
    const mirrored = mirrorFormDatesFromLatest(periods)
    setForm({
      ...base,
      periods,
      hire_date: mirrored.hire_date || base.hire_date,
      end_date: mirrored.end_date || base.end_date,
    })
    setFormOpen(true)
  }

  const patch = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      if (field === 'last_name' || field === 'first_name') {
        next.tech_name = buildFullName(
          field === 'last_name' ? value : next.last_name,
          field === 'first_name' ? value : next.first_name
        )
      }
      // Auto-sync: Πρόσληψη/Λήξη ↔ τελευταία περίοδος
      if (field === 'hire_date' || field === 'end_date' || field === 'employment_type') {
        next.periods = syncLatestPeriodFromForm(
          next.periods,
          next.hire_date,
          next.end_date,
          next.employment_type
        )
      }
      return next
    })
  }

  const patchPeriod = (periodId, field, value) => {
    setForm((prev) => {
      const periods = (prev.periods || []).map((p) =>
        p.id === periodId ? { ...p, [field]: value } : p
      )
      const latest = getLatestPeriod(periods)
      const mirrored =
        latest && latest.id === periodId ? mirrorFormDatesFromLatest(periods) : null
      return {
        ...prev,
        periods,
        ...(mirrored
          ? {
              hire_date: mirrored.hire_date,
              end_date: mirrored.end_date,
              ...(field === 'employment_type' ? { employment_type: value } : {}),
            }
          : {}),
      }
    })
  }

  const handleAddPeriod = () => {
    setForm((prev) => {
      const periods = addNewPeriod(prev.periods, prev.employment_type)
      const mirrored = mirrorFormDatesFromLatest(periods)
      const latestId = getLatestPeriod(periods)?.id || null
      queueMicrotask(() => setEditingPeriodId(latestId))
      return {
        ...prev,
        periods,
        hire_date: mirrored.hire_date,
        end_date: mirrored.end_date,
      }
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const overlap = findPeriodOverlapError(form.periods)
      if (overlap) throw new Error(overlap)

      const payload = personnelToDb(form)
      if (!payload.tech_name) throw new Error('Συμπλήρωσε επώνυμο/όνομα')

      // Ίδια θέση με άλλον → σπρώξιμο θέσεων ≥ N προς τα κάτω
      await shiftPersonnelPositionsFrom({
        personnel,
        targetPosition: form.position_number,
        excludeId: editingId,
        client: diasClient,
      })

      let result
      if (editingId) {
        result = await diasClient
          .from('personnel')
          .update(payload)
          .eq('id', editingId)
          .select('*')
          .single()
      } else {
        result = await diasClient.from('personnel').insert(payload).select('*').single()
      }
      if (result.error) throw result.error

      const personnelId = result.data?.id
      if (personnelId && (form.periods || []).length) {
        const periodResult = await savePersonnelPeriods(personnelId, form.periods)
        if (periodResult?.missingTable) {
          console.warn(
            'personnel_periods table missing — τρέξε supabase/11_personnel_periods.sql στο DIAS'
          )
        }
      }

      const saved = personnelFromDb(result.data)
      setFormOpen(false)
      await onMutated?.()
      if (saved) {
        onSelect?.(saved)
        if (saved.is_active === false) onListFilterChange?.('dismissed')
        else if (saved.employment_type === 'temporary') onListFilterChange?.('temporary')
      }
    } catch (err) {
      if (isMissingTableError(err) || String(err.message || '').includes('employment_type')) {
        setError(
          'Λείπουν στήλες καρτέλας στο personnel. Τρέξε supabase/02_personnel_hr.sql και 10_personnel_card_fields.sql στο DIAS.'
        )
      } else {
        setError(
          formatSupabaseError(err, { table: 'personnel', clientLabel: 'DIAS ERP' }) ||
            err.message ||
            String(err)
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const handlePhotoPick = async (fileList) => {
    const file = fileList?.[0]
    if (!file) return
    setPhotoUploading(true)
    setPhotoError(null)
    try {
      const techKey = form.tech_id || form.code || form.tech_name || 'new'
      const url = await uploadPersonnelPhoto(file, techKey, diasClient)
      patch('photo_url', url)
    } catch (err) {
      setPhotoError(err?.message || 'Αποτυχία ανεβάσματος φωτογραφίας')
    } finally {
      setPhotoUploading(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  const handleArchive = async (person) => {
    if (!person?.id) return
    if (!window.confirm(`Απόλυση «${person.tech_name}»; (μεταφορά στους Απολυμένους)`)) return
    setSaving(true)
    setError(null)
    try {
      const { error: err } = await diasClient
        .from('personnel')
        .update({
          is_active: false,
          archived_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', person.id)
      if (err) throw err
      await onMutated?.()
    } catch (err) {
      setError(formatSupabaseError(err, { table: 'personnel', clientLabel: 'DIAS ERP' }))
    } finally {
      setSaving(false)
    }
  }

  const handleRestore = async (person) => {
    if (!person?.id) return
    setSaving(true)
    setError(null)
    try {
      const { error: err } = await diasClient
        .from('personnel')
        .update({
          is_active: true,
          archived_at: null,
          end_date: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', person.id)
      if (err) throw err
      await onMutated?.()
    } catch (err) {
      setError(formatSupabaseError(err, { table: 'personnel', clientLabel: 'DIAS ERP' }))
    } finally {
      setSaving(false)
    }
  }

  const handleImportAdmin = async () => {
    const list = payrollTechs(adminTechs || [])
    if (!list.length) {
      setError('Δεν βρέθηκαν ενεργοί τεχνικοί στο Admin για εισαγωγή.')
      return
    }
    if (
      !window.confirm(
        `Εισαγωγή ${list.length} τεχνικών από Admin (μόνο για βάρδιες) στο DIAS προσωπικό;`
      )
    ) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const rows = list.map((t) => {
        const { lastName, firstName } = splitTechName(t.name)
        return {
          tech_id: String(t.id),
          tech_name: t.name,
          code: String(t.id),
          last_name: lastName !== '-' ? lastName : null,
          first_name: firstName !== '-' ? firstName : null,
          admin_tech_id: String(t.id),
          employment_type: 'permanent',
          payment_method: 'salary',
          is_active: true,
          updated_at: new Date().toISOString(),
        }
      })
      const { error: err } = await diasClient.from('personnel').upsert(rows, { onConflict: 'tech_id' })
      if (err) throw err
      await onMutated?.()
    } catch (err) {
      setError(
        formatSupabaseError(err, { table: 'personnel', clientLabel: 'DIAS ERP' }) || err.message
      )
    } finally {
      setSaving(false)
    }
  }

  const Wrapper = isSidebar ? 'aside' : 'section'

  return (
    <Wrapper
      className={
        isSidebar
          ? 'flex max-h-56 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md md:max-h-none md:w-80 md:self-stretch'
          : inModal
            ? 'flex h-full min-h-0 flex-col overflow-hidden'
            : 'flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md'
      }
    >
      <div className={`border-b border-white/10 px-3 ${isSidebar ? 'py-3' : 'pb-3 pt-2'}`}>
        {isSidebar ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Προσωπικο DIAS
            </p>
            <p className="mt-0.5 text-sm font-semibold text-white">Ενεργοί μόνιμοι</p>
          </>
        ) : null}

        {!isSidebar && (
          <>
            <div className="flex flex-wrap gap-1">
              {[
                { id: 'active', label: 'Ενεργοί' },
                { id: 'temporary', label: 'Έκτακτοι' },
                { id: 'dismissed', label: 'Απολυμένοι' },
                { id: 'all', label: 'Όλοι' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    onListFilterChange?.(f.id)
                    if (f.id === 'temporary' || f.id === 'dismissed') onTypeFilterChange?.('all')
                  }}
                  className={`rounded-lg px-2 py-1 text-[10px] font-bold tracking-wide ${
                    listFilter === f.id
                      ? 'bg-cyan-500/25 text-cyan-100'
                      : 'bg-white/5 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {greekCapsLabel(f.label)}
                </button>
              ))}
            </div>

            {(listFilter === 'all' || listFilter === 'active') && (
            <select
              value={typeFilter}
              onChange={(e) => onTypeFilterChange?.(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-2 py-1.5 text-xs text-white"
            >
              <option value="all">Όλες οι κατηγορίες</option>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            )}
          </>
        )}

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Αναζήτηση..."
          className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />

        {!isSidebar && (
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-100"
            >
              + Νέος
            </button>
            <button
              type="button"
              onClick={handleImportAdmin}
              disabled={saving}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 disabled:opacity-50"
              title="Φέρνει μόνο όσους υπάρχουν στο Admin για βάρδιες"
            >
              Από Admin
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-2 mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-100">
          {error}
        </div>
      )}

      <div
        className={
          isSidebar
            ? 'min-h-0 flex-1 overflow-y-auto p-2'
            : inModal
              ? 'min-h-0 flex-1 overflow-y-auto p-2'
              : 'max-h-[min(68vh,760px)] overflow-y-auto p-2'
        }
      >
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-500">
            {isSidebar
              ? 'Δεν υπάρχουν ενεργοί μόνιμοι υπάλληλοι.'
              : 'Κενό προσωπικό DIAS. Πρόσθεσε υπάλληλο ή εισήγαγε από Admin (βάρδιες).'}
          </p>
        ) : (
          filtered.map((p) => {
            const selected = selectedId === p.id
            const initials = (p.last_name || p.tech_name || '?').slice(0, 2).toUpperCase()
            const avatarTone = selected
              ? 'bg-cyan-500/25 text-cyan-100'
              : 'bg-slate-800 text-slate-300'
            return isSidebar ? (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect?.(p)}
                className={`mb-1 flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition ${
                  selected
                    ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-100'
                    : 'border-transparent text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <PersonAvatar
                  photoUrl={p.photo_url}
                  initials={initials}
                  name={p.tech_name}
                  className={`h-9 w-9 ${avatarTone}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.tech_name}</span>
                  <span className="block truncate text-[10px] text-slate-500">
                    #{p.code || p.tech_id}
                  </span>
                </span>
              </button>
            ) : (
              <div
                key={p.id}
                className={`mb-1 flex w-full items-center justify-between gap-2 rounded-xl border py-1 pl-1.5 pr-3 ${
                  selected
                    ? 'border-cyan-500/40 bg-cyan-500/15'
                    : 'border-transparent hover:bg-white/5'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect?.(p)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left"
                >
                  <PersonAvatar
                    photoUrl={p.photo_url}
                    initials={initials}
                    name={p.tech_name}
                    className={`h-10 w-10 ${avatarTone}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {p.tech_name}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">
                      #{p.code || p.tech_id} - {employmentLabel(p.employment_type)}
                      {!p.is_active ? ' - Απολυμένος' : ''}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    title="Επεξεργασία"
                    aria-label="Επεξεργασία"
                    onClick={() => openEdit(p)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-700 hover:text-white"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                    </svg>
                  </button>
                  {p.is_active ? (
                    <button
                      type="button"
                      title="Απόλυση"
                      aria-label="Απόλυση"
                      onClick={() => handleArchive(p)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-rose-500/25 hover:text-rose-100"
                    >
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-4 w-4"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.341 10.234A1.75 1.75 0 006.105 17.5h7.79a1.75 1.75 0 001.75-1.515l.341-10.234.149.022a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  ) : (
                    <button
                      type="button"
                      title="Επαναφορά"
                      aria-label="Επαναφορά"
                      onClick={() => handleRestore(p)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-emerald-500/25 hover:text-emerald-100"
                    >
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-4 w-4"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.39a.75.75 0 00-.75.75v3.842a.75.75 0 001.5 0v-2.26l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.388zm-9.624-2.848a5.5 5.5 0 019.201-2.466l.312.311H12.77a.75.75 0 000 1.5h3.843a.75.75 0 00.75-.75V3.329a.75.75 0 00-1.5 0V5.59l-.31-.31A7 7 0 003.84 8.417a.75.75 0 001.45.388z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="border-t border-white/10 px-3 py-2 text-[10px] text-slate-500">
        {isSidebar
          ? `${filtered.length} ενεργοί μόνιμοι`
          : `${filtered.length} εμφανίζονται · ${(personnel || []).length} σύνολο`}
      </div>

      {!isSidebar &&
        formOpen &&
        createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]"
            aria-label="Κλείσιμο"
            onClick={() => setFormOpen(false)}
          />
          <div
            className="relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
            style={{
              width: formSize.width,
              height: formSize.height,
              maxWidth: 'calc(100vw - 1.5rem)',
              maxHeight: 'calc(100vh - 1.5rem)',
            }}
          >
            {formResizeHandle('n', 'ns-resize', 'left-2 right-2 top-0 h-2')}
            {formResizeHandle('s', 'ns-resize', 'left-2 right-2 bottom-0 h-2')}
            {formResizeHandle('e', 'ew-resize', 'top-2 bottom-2 right-0 w-2')}
            {formResizeHandle('w', 'ew-resize', 'top-2 bottom-2 left-0 w-2')}
            {formResizeHandle('nw', 'nwse-resize', 'left-0 top-0 h-3 w-3')}
            {formResizeHandle('ne', 'nesw-resize', 'right-0 top-0 h-3 w-3')}
            {formResizeHandle('sw', 'nesw-resize', 'bottom-0 left-0 h-3 w-3')}
            {formResizeHandle('se', 'nwse-resize', 'bottom-0 right-0 h-4 w-4')}

            <div className="shrink-0 border-b border-white/10 px-5 py-4">
              <h3 className="text-lg font-bold text-white">
                {editingId ? 'Επεξεργασία υπαλλήλου' : 'Νέος υπάλληλος'}
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Καρτέλα παλιού ERP. Ημερομηνία λήξης → Απολυμένοι. Γκρι πεδία: σύντομα ενεργοποίηση λογικής.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:px-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Επώνυμο">
                <input
                  value={form.last_name}
                  onChange={(e) => patch('last_name', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Όνομα">
                <input
                  value={form.first_name}
                  onChange={(e) => patch('first_name', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Κωδικός">
                <input
                  value={form.code}
                  onChange={(e) => patch('code', e.target.value)}
                  className={inputClass}
                  placeholder="π.χ. 307"
                />
              </Field>
              <Field label="Αρ. θέσης τεχνικού">
                <input
                  value={form.position_number}
                  onChange={(e) => patch('position_number', e.target.value)}
                  className={inputClass}
                  placeholder="π.χ. 17"
                />
              </Field>
              <Field label="tech_id (μοναδικό)">
                <input
                  value={form.tech_id}
                  onChange={(e) => patch('tech_id', e.target.value)}
                  className={inputClass}
                  placeholder="αυτόματο αν κενό"
                  disabled={Boolean(editingId)}
                />
              </Field>
              <Field label="Κατηγορία">
                <select
                  value={form.employment_type}
                  onChange={(e) => patch('employment_type', e.target.value)}
                  className={inputClass}
                >
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Πληρωμή / παραστατικό">
                <select
                  value={form.payment_method}
                  onChange={(e) => patch('payment_method', e.target.value)}
                  className={inputClass}
                >
                  {PAYMENT_METHODS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="col-span-2 grid grid-cols-2 gap-3 sm:col-span-4">
                <Field label="Πρόσληψη">
                  <GreekDateInput
                    value={form.hire_date || ''}
                    onChange={(iso) => patch('hire_date', iso)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Λήξη">
                  <GreekDateInput
                    value={form.end_date || ''}
                    onChange={(iso) => patch('end_date', iso)}
                    className={inputClass}
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    Αν συμπληρωθεί, ο υπάλληλος θεωρείται Απολυμένος/Ανενεργός μετά από αυτή την
                    ημερομηνία.
                  </p>
                </Field>
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-3 sm:col-span-4 sm:grid-cols-6">
                <Field label="Διεύθυνση" className="sm:col-span-2">
                  <input
                    value={form.address}
                    onChange={(e) => patch('address', e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Αριθμός">
                  <input
                    value={form.address_number}
                    onChange={(e) => patch('address_number', e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Περιοχή" className="sm:col-span-2">
                  <input
                    value={form.area}
                    onChange={(e) => patch('area', e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Τ.Κ.">
                  <input
                    value={form.zipcode}
                    onChange={(e) => patch('zipcode', e.target.value)}
                    className={inputClass}
                    inputMode="numeric"
                    autoComplete="postal-code"
                  />
                </Field>
              </div>
              <Field label="Τηλέφωνο">
                <input
                  value={form.phone}
                  onChange={(e) => patch('phone', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Κινητό">
                <input
                  value={form.mobile}
                  onChange={(e) => patch('mobile', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Ημ. γέννησης">
                <GreekDateInput
                  value={form.birth_date || ''}
                  onChange={(iso) => patch('birth_date', iso)}
                  className={inputClass}
                />
              </Field>
              <Field label="Γιορτή">
                <input
                  value={form.name_day}
                  onChange={(e) => patch('name_day', e.target.value)}
                  className={inputClass}
                  placeholder="π.χ. 06/12"
                />
              </Field>
              <Field label="Αρ. ταυτότητας">
                <input
                  value={form.id_number}
                  onChange={(e) => patch('id_number', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="ΑΦΜ">
                <input
                  value={form.afm}
                  onChange={(e) => patch('afm', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="ΔΟΥ">
                <input
                  value={form.doy}
                  onChange={(e) => patch('doy', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Οικογ. κατάσταση">
                <select
                  value={form.marital_status}
                  onChange={(e) => patch('marital_status', e.target.value)}
                  className={inputClass}
                >
                  {MARITAL_STATUSES.map((t) => (
                    <option key={t.value || 'empty'} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Εντός γραφείου">
                <label className="mt-1 flex h-[38px] cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.in_office === true}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setForm((prev) => ({
                        ...prev,
                        in_office: checked,
                        ...(checked ? { admin_tech_id: '' } : {}),
                      }))
                    }}
                    className="h-4 w-4 rounded border-white/20"
                  />
                  Ναι
                </label>
              </Field>

              <Field label="Τράπεζα">
                <select
                  value={form.bank_name}
                  onChange={(e) => patch('bank_name', e.target.value)}
                  className={inputClass}
                >
                  {BANKS.map((t) => (
                    <option key={t.value || 'empty'} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="IBAN" className="sm:col-span-2">
                <input
                  value={form.iban}
                  onChange={(e) => patch('iban', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Δικαιούχος">
                <input
                  value={form.bank_account_holder}
                  onChange={(e) => patch('bank_account_holder', e.target.value)}
                  className={inputClass}
                />
              </Field>

              {!form.in_office ? (
                <Field label="Admin tech id (ώρες βάρδιας)" className="col-span-2 sm:col-span-2">
                  <input
                    value={form.admin_tech_id}
                    onChange={(e) => patch('admin_tech_id', e.target.value)}
                    className={inputClass}
                    placeholder="κενό = χωρίς ώρες από Admin"
                    list="admin-tech-ids"
                  />
                  <datalist id="admin-tech-ids">
                    {(adminTechs || []).map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.name}
                      </option>
                    ))}
                  </datalist>
                </Field>
              ) : null}
              <Field label="Φωτογραφία προφίλ" className="col-span-2 sm:col-span-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handlePhotoPick(e.target.files)}
                    />
                    <button
                      type="button"
                      disabled={photoUploading || saving}
                      onClick={() => photoInputRef.current?.click()}
                      title="Κλικ για ανέβασμα φωτογραφίας"
                      className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-slate-800 transition hover:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:cursor-wait disabled:opacity-80"
                    >
                      {form.photo_url ? (
                        <img
                          src={form.photo_url}
                          alt="Προεπισκόπηση"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center text-[10px] leading-tight text-slate-500 group-hover:text-cyan-200/80">
                          <span className="text-lg leading-none">+</span>
                          χωρίς φωτο
                        </span>
                      )}
                      {photoUploading ? (
                        <span className="absolute inset-0 flex items-center justify-center bg-slate-950/70">
                          <span className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300" />
                        </span>
                      ) : (
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-950/70 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-100/90 opacity-0 transition group-hover:opacity-100">
                          Αλλαγή
                        </span>
                      )}
                    </button>
                    {form.photo_url && !photoUploading ? (
                      <button
                        type="button"
                        title="Αφαίρεση φωτογραφίας"
                        aria-label="Αφαίρεση φωτογραφίας"
                        disabled={saving}
                        onClick={() => {
                          patch('photo_url', '')
                          setPhotoError(null)
                        }}
                        className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 transition hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-100 disabled:opacity-50"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
                          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                  {photoError ? (
                    <p className="text-[11px] font-medium text-rose-300">{photoError}</p>
                  ) : (
                    <p className="text-[10px] text-slate-500">
                      Κλικ στο avatar για ανέβασμα. Αποθήκευση στη βάση με το κουμπί Αποθήκευση.
                    </p>
                  )}
                </div>
              </Field>
              <Field label="Σχόλια / σημειώσεις" className="col-span-2 sm:col-span-4">
                <textarea
                  value={form.notes}
                  onChange={(e) => patch('notes', e.target.value)}
                  className={`${inputClass} min-h-[70px]`}
                />
              </Field>
            </div>

            {/*
              TODO: Table to log historical start/end dates for re-hired employees
              Hybrid: form hire/end auto-sync latest period; + Νέα Περίοδος / pencil for manual history.
              TODO: DB exclusion constraint for non-overlapping ranges (see 11_personnel_periods.sql)
            */}
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold tracking-wider text-slate-400">
                    {greekCapsLabel('Περίοδοι')} · Ιστορικό συμβάσεων
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    Η Πρόσληψη/Λήξη πάνω καθρεφτίζουν την πιο πρόσφατη περίοδο.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddPeriod}
                  disabled={saving}
                  className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-50"
                >
                  + Νέα Περίοδος
                </button>
              </div>

              {periodsOverlapError ? (
                <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-100">
                  {periodsOverlapError}
                </div>
              ) : null}

              <div className="mt-2 overflow-hidden rounded-lg border border-white/10">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/60 text-[10px] tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">{greekCapsLabel('Από')}</th>
                      <th className="px-3 py-2">{greekCapsLabel('Μέχρι')}</th>
                      <th className="px-3 py-2">{greekCapsLabel('Κατηγορία')}</th>
                      <th className="px-2 py-2 text-right"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortPeriods(form.periods || []).length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-slate-500" colSpan={4}>
                          Δεν υπάρχουν περίοδοι ακόμα. Συμπλήρωσε Πρόσληψη ή πάτα «+ Νέα Περίοδος».
                        </td>
                      </tr>
                    ) : (
                      sortPeriods(form.periods || []).map((period) => {
                        const isLatest = getLatestPeriod(form.periods)?.id === period.id
                        const isEditing = editingPeriodId === period.id
                        return (
                          <tr
                            key={period.id}
                            className={`border-t border-white/5 ${
                              isLatest ? 'bg-cyan-500/5' : ''
                            }`}
                          >
                            <td className="px-2 py-1.5 align-middle">
                              {isEditing ? (
                                <GreekDateInput
                                  value={period.start_date || ''}
                                  onChange={(iso) => patchPeriod(period.id, 'start_date', iso)}
                                  className={inputClass}
                                />
                              ) : (
                                <span className="px-1 font-mono text-[11px] text-slate-200">
                                  {period.start_date
                                    ? isoDateToGreek(period.start_date)
                                    : '—'}
                                  {isLatest ? (
                                    <span className="ml-1 text-[9px] font-sans font-semibold uppercase text-cyan-400/80">
                                      τρέχουσα
                                    </span>
                                  ) : null}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 align-middle">
                              {isEditing ? (
                                <GreekDateInput
                                  value={period.end_date || ''}
                                  onChange={(iso) => patchPeriod(period.id, 'end_date', iso)}
                                  className={inputClass}
                                />
                              ) : (
                                <span className="px-1 font-mono text-[11px] text-slate-200">
                                  {period.end_date ? isoDateToGreek(period.end_date) : '—'}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 align-middle">
                              {isEditing ? (
                                <select
                                  value={period.employment_type || 'permanent'}
                                  onChange={(e) =>
                                    patchPeriod(period.id, 'employment_type', e.target.value)
                                  }
                                  className={inputClass}
                                >
                                  {EMPLOYMENT_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>
                                      {t.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="px-1 text-[11px]">
                                  {employmentLabel(period.employment_type)}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right align-middle">
                              <button
                                type="button"
                                title={isEditing ? 'Κλείσιμο επεξεργασίας' : 'Επεξεργασία περιόδου'}
                                aria-label={isEditing ? 'Κλείσιμο επεξεργασίας' : 'Επεξεργασία περιόδου'}
                                onClick={() =>
                                  setEditingPeriodId(isEditing ? null : period.id)
                                }
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-700 hover:text-white"
                              >
                                {isEditing ? (
                                  <span className="text-[11px] font-bold">✓</span>
                                ) : (
                                  <svg
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    className="h-3.5 w-3.5"
                                    aria-hidden
                                  >
                                    <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                                  </svg>
                                )}
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {form.payment_method && (
              <p className="mt-2 text-[11px] text-slate-500">
                {paymentMethodLabel(form.payment_method)} · εμφανίζεται στις Αποδοχές (μόνο ανάγνωση)
              </p>
            )}
            </div>

            <div className="shrink-0 border-t border-white/10 bg-slate-900 px-5 py-4">
              {error && (
                <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {error}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || Boolean(periodsOverlapError)}
                  className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-sm font-bold text-emerald-100 disabled:opacity-50"
                >
                  {saving ? 'Αποθήκευση...' : 'Αποθήκευση'}
                </button>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white"
                >
                  Άκυρο
                </button>
              </div>
            </div>

            <div
              className="pointer-events-none absolute bottom-1.5 right-1.5 z-10 h-3 w-3 border-b-2 border-r-2 border-cyan-400/50"
              aria-hidden
            />
          </div>
        </div>,
        document.body
      )}
    </Wrapper>
  )
}

const FORM_MODAL_MIN_W = 420
const FORM_MODAL_MIN_H = 360

function defaultFormModalSize() {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 960
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  return {
    width: Math.min(768, Math.max(FORM_MODAL_MIN_W, vw - 32)),
    height: Math.min(Math.round(vh * 0.85), Math.max(FORM_MODAL_MIN_H, vh - 32)),
  }
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="text-[10px] font-semibold tracking-wider text-slate-400">
        {greekCapsLabel(label)}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  )
}

/**
 * UI: ηη/μμ/εεεε. Form/DB value: YYYY-MM-DD (unchanged for personnelToDb).
 */
function GreekDateInput({ value, onChange, className = '', disabled = false }) {
  const [text, setText] = useState(() => isoDateToGreek(value))

  useEffect(() => {
    setText(isoDateToGreek(value))
  }, [value])

  const commit = (raw) => {
    const trimmed = String(raw || '').trim()
    if (!trimmed) {
      onChange('')
      setText('')
      return
    }
    const iso = parseToIsoDate(trimmed)
    if (iso) {
      onChange(iso)
      setText(isoDateToGreek(iso))
      return
    }
    // Invalid → keep previous ISO value / display (don't corrupt form state)
    setText(isoDateToGreek(value))
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="ηη/μμ/εεεε"
      disabled={disabled}
      value={text}
      onChange={(e) => setText(maskGreekDateInput(e.target.value))}
      onBlur={() => commit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(text)
        }
      }}
      className={className}
    />
  )
}

function PersonAvatar({ photoUrl, initials, name, className = '' }) {
  const src = String(photoUrl || '').trim()
  if (src) {
    return (
      <span className={`relative shrink-0 overflow-hidden rounded-full border border-white/10 ${className}`}>
        <img
          src={src}
          alt={name || 'Φωτογραφία'}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </span>
    )
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold ${className}`}
      aria-hidden={!name}
      title={name || undefined}
    >
      {initials}
    </span>
  )
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white'
