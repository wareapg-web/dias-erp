import React, { useMemo, useState } from 'react'
import { diasClient, formatSupabaseError, isMissingTableError } from '../lib/supabase'
import {
  EMPLOYMENT_TYPES,
  PAYMENT_METHODS,
  buildFullName,
  emptyPersonnelForm,
  employmentLabel,
  paymentMethodLabel,
  personnelFromDb,
  personnelToDb,
} from '../lib/personnel'
import { splitTechName } from '../lib/payrollAnalysis'
import { payrollTechs } from '../lib/crewPayroll'

export default function PersonnelPanel({
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
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyPersonnelForm())
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let list = [...(personnel || [])]
    if (listFilter === 'active') list = list.filter((p) => p.is_active !== false)
    if (listFilter === 'archive') list = list.filter((p) => p.is_active === false)
    if (typeFilter && typeFilter !== 'all') {
      list = list.filter((p) => p.employment_type === typeFilter)
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
    list.sort((a, b) => String(a.tech_name).localeCompare(String(b.tech_name), 'el'))
    return list
  }, [personnel, listFilter, typeFilter, search])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyPersonnelForm())
    setError(null)
    setFormOpen(true)
  }

  const openEdit = (person) => {
    setEditingId(person.id)
    setForm(personnelFromDb(person))
    setError(null)
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
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = personnelToDb(form)
      if (!payload.tech_name) throw new Error('Συμπλήρωσε επώνυμο/όνομα')

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
      setFormOpen(false)
      await onMutated?.()
      if (result.data) onSelect?.(personnelFromDb(result.data))
    } catch (err) {
      if (isMissingTableError(err) || String(err.message || '').includes('employment_type')) {
        setError(
          'Λείπουν στήλες HR στο personnel. Τρέξε το SQL supabase/02_personnel_hr.sql στο DIAS.'
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

  const handleArchive = async (person) => {
    if (!person?.id) return
    if (!window.confirm(`Αρχειοθέτηση «${person.tech_name}»; (δεν διαγράφεται οριστικά)`)) return
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

  return (
    <aside className="flex max-h-56 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75 shadow-xl backdrop-blur-md md:max-h-none md:w-80 md:self-stretch">
      <div className="border-b border-white/10 px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
          Προσωπικό DIAS
        </p>
        <p className="mt-0.5 text-sm font-semibold text-white">Κατάλογος υπαλλήλων</p>

        <div className="mt-2 flex flex-wrap gap-1">
          {[
            { id: 'active', label: 'Ενεργοί' },
            { id: 'archive', label: 'Αρχείο' },
            { id: 'all', label: 'Όλοι' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onListFilterChange?.(f.id)}
              className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                listFilter === f.id
                  ? 'bg-cyan-500/25 text-cyan-100'
                  : 'bg-white/5 text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

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

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Αναζήτηση..."
          className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />

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
      </div>

      {error && (
        <div className="mx-2 mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-100">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-500">
            Κενό προσωπικό DIAS. Πρόσθεσε υπάλληλο ή εισήγαγε από Admin (βάρδιες).
          </p>
        ) : (
          filtered.map((p) => {
            const selected = selectedId === p.id
            const initials = (p.last_name || p.tech_name || '?').slice(0, 2).toUpperCase()
            return (
              <div
                key={p.id}
                className={`mb-1 flex w-full items-start gap-1 rounded-xl border px-1 py-1 ${
                  selected
                    ? 'border-cyan-500/40 bg-cyan-500/15'
                    : 'border-transparent hover:bg-white/5'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect?.(p)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5 py-1.5 text-left"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      selected ? 'bg-cyan-500/25 text-cyan-100' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {p.tech_name}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">
                      #{p.code || p.tech_id} · {employmentLabel(p.employment_type)}
                      {!p.is_active ? ' · Αρχείο' : ''}
                    </span>
                  </span>
                </button>
                <div className="flex flex-col gap-0.5 py-1 pr-1">
                  <button
                    type="button"
                    title="Επεξεργασία"
                    onClick={() => openEdit(p)}
                    className="rounded px-1.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white"
                  >
                    ✎
                  </button>
                  {p.is_active ? (
                    <button
                      type="button"
                      title="Αρχείο"
                      onClick={() => handleArchive(p)}
                      className="rounded px-1.5 text-[10px] text-slate-400 hover:bg-rose-500/20 hover:text-rose-200"
                    >
                      ⌁
                    </button>
                  ) : (
                    <button
                      type="button"
                      title="Επαναφορά"
                      onClick={() => handleRestore(p)}
                      className="rounded px-1.5 text-[10px] text-slate-400 hover:bg-emerald-500/20 hover:text-emerald-200"
                    >
                      ↺
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="border-t border-white/10 px-3 py-2 text-[10px] text-slate-500">
        {filtered.length} εμφανίζονται · {(personnel || []).length} σύνολο
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            aria-label="Κλείσιμο"
            onClick={() => setFormOpen(false)}
          />
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">
              {editingId ? 'Επεξεργασία υπαλλήλου' : 'Νέος υπάλληλος'}
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Αποθήκευση στο DIAS. Soft-delete → Αρχείο (όχι οριστική διαγραφή).
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
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
                  placeholder="π.χ. 423"
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
              <Field label="Πρόσληψη">
                <input
                  type="date"
                  value={form.hire_date || ''}
                  onChange={(e) => patch('hire_date', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Λήξη (έκτακτοι)">
                <input
                  type="date"
                  value={form.end_date || ''}
                  onChange={(e) => patch('end_date', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Admin tech id (ώρες βάρδιας)" className="col-span-2">
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
              <Field label="Σημειώσεις" className="col-span-2">
                <textarea
                  value={form.notes}
                  onChange={(e) => patch('notes', e.target.value)}
                  className={`${inputClass} min-h-[70px]`}
                />
              </Field>
            </div>

            {form.payment_method && (
              <p className="mt-2 text-[11px] text-slate-500">
                {paymentMethodLabel(form.payment_method)} · λεπτομέρειες και στις Αποδοχές
              </p>
            )}

            {error && (
              <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                {error}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
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
        </div>
      )}
    </aside>
  )
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  )
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white'
