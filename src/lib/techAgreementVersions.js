/** tech_agreement_versions — Master ιστορικό πλήρων πακέτων αποδοχών. */

import { diasClient, formatSupabaseError, isMissingTableError } from './supabase'
import {
  emptyEarningsForm,
  earningsFromDb,
  earningsToDb,
  normalizeFixedExpenseSettings,
} from './techEarnings'

export const AGREEMENT_SNAPSHOT_VERSION = 1

function normalizeAutoTransferSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    out[String(k)] = v === true
  }
  return out
}

/** Κανονικοποίηση snapshot από DB → UI form shape. */
export function snapshotToForm(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return emptyEarningsForm()
  const base = emptyEarningsForm()
  const merged = { ...base }
  for (const key of Object.keys(base)) {
    if (key === 'auto_transfer_settings' || key === 'fixed_expense_settings') continue
    if (snapshot[key] === undefined || snapshot[key] === null) continue
    const v = snapshot[key]
    if (typeof v === 'number' && Number.isFinite(v)) {
      merged[key] = String(v)
    } else if (typeof v === 'boolean') {
      merged[key] = v
    } else {
      merged[key] = v
    }
  }
  merged.auto_transfer_settings = normalizeAutoTransferSettings(
    snapshot.auto_transfer_settings ?? base.auto_transfer_settings
  )
  merged.fixed_expense_settings = normalizeFixedExpenseSettings(
    snapshot.fixed_expense_settings ?? base.fixed_expense_settings
  )
  // Παλιά snapshots χωρίς το κλειδί → true
  if (merged.invoice_gross_up !== false) merged.invoice_gross_up = true
  return merged
}

/** UI form → JSON για αποθήκευση στο Master. */
export function formToSnapshot(form) {
  const clean = { ...(form || emptyEarningsForm()) }
  clean.auto_transfer_settings = normalizeAutoTransferSettings(clean.auto_transfer_settings)
  clean.fixed_expense_settings = normalizeFixedExpenseSettings(clean.fixed_expense_settings)
  clean._v = AGREEMENT_SNAPSHOT_VERSION
  return clean
}

export function isAgreementActive(row) {
  return row && (row.end_date == null || row.end_date === '')
}

export function agreementStatusLabel(row) {
  return isAgreementActive(row) ? 'Ενεργή' : 'Ιστορικό'
}

/** Σημειώσεις συμφωνίας από snapshot (όχι mirror tech_earnings). */
export function agreementNotesFromRow(row) {
  const snap = row?.earnings_snapshot
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return ''
  return String(snap.agreement_notes || '').trim()
}

function dateOnly(value) {
  const s = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

/**
 * Έκδοση συμφωνίας που κάλυπτε τον λογιστικό μήνα (year, month).
 * Overlap: start ≤ τέλος μήνα · (end null ή end ≥ αρχή μήνα).
 * Πολλαπλά → πιο πρόσφατη start_date (μετά created_at).
 */
export function findAgreementForMonth(versions, year, month) {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null

  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const covering = []
  for (const row of versions || []) {
    const start = dateOnly(row?.start_date)
    if (!start || start > monthEnd) continue
    const end = dateOnly(row?.end_date)
    if (end && end < monthStart) continue
    covering.push(row)
  }
  if (covering.length === 0) return null

  covering.sort((a, b) => {
    const as = dateOnly(a.start_date)
    const bs = dateOnly(b.start_date)
    if (as !== bs) return bs.localeCompare(as)
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })
  return covering[0]
}

/**
 * Όροι παραστατικού για μήνα: ιστορικό snapshot → fallback form/mirror → defaults.
 * @returns {{ invoiceGrossUp: boolean, taxPercent: number, agreement: object|null }}
 */
export function resolveInvoiceTermsForMonth(versions, year, month, fallbackForm = null) {
  const agreement = findAgreementForMonth(versions, year, month)
  const fromSnap = agreement ? snapshotToForm(agreement.earnings_snapshot) : null
  const fb = fallbackForm || emptyEarningsForm()
  const source = fromSnap || fb

  const rawPct = source.extra
  let taxPercent = 20
  if (rawPct !== '' && rawPct != null) {
    const n = Number(String(rawPct).replace(',', '.'))
    if (Number.isFinite(n) && n !== 0) taxPercent = n
  }

  return {
    agreement,
    invoiceGrossUp: source.invoice_gross_up !== false,
    taxPercent,
  }
}

/**
 * Λίστα εκδόσεων συμφωνίας (νεότερες πρώτα).
 * @returns {Promise<{ rows: object[], missingTable: boolean, error: string|null }>}
 */
export async function loadAgreementVersions(techId) {
  if (!techId) return { rows: [], missingTable: false, error: null }
  try {
    const { data, error } = await diasClient
      .from('tech_agreement_versions')
      .select('*')
      .eq('tech_id', String(techId))
      .order('start_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      return {
        rows: [],
        missingTable: isMissingTableError(error),
        error: formatSupabaseError(error, {
          table: 'tech_agreement_versions',
          clientLabel: 'DIAS ERP',
        }),
      }
    }
    return { rows: data || [], missingTable: false, error: null }
  } catch (err) {
    return {
      rows: [],
      missingTable: isMissingTableError(err),
      error:
        formatSupabaseError(err, {
          table: 'tech_agreement_versions',
          clientLabel: 'DIAS ERP',
        }) || String(err?.message || err),
    }
  }
}

export function findActiveAgreement(rows = []) {
  return (rows || []).find((r) => isAgreementActive(r)) || null
}

/**
 * Αν δεν υπάρχει ενεργή έκδοση αλλά υπάρχει tech_earnings → seed Master από Mirror.
 */
export async function ensureActiveAgreementFromEarnings(tech, earningsRow) {
  if (!tech?.id || !earningsRow) return null
  const { rows, missingTable, error } = await loadAgreementVersions(tech.id)
  if (missingTable || error) return null
  if (findActiveAgreement(rows)) return findActiveAgreement(rows)

  const form = earningsFromDb(earningsRow)
  const snapshot = formToSnapshot(form)
  const start =
    String(earningsRow.updated_at || earningsRow.created_at || '').slice(0, 10) ||
    new Date().toISOString().slice(0, 10)

  const { data, error: rpcError } = await diasClient.rpc('create_tech_agreement_version', {
    p_tech_id: String(tech.id),
    p_start_date: start,
    p_snapshot: snapshot,
  })
  if (rpcError) {
    console.warn('[agreement seed]', rpcError.message || rpcError)
    return null
  }
  return data
}

/**
 * Νέα συμφωνία (Master) + sync Mirror tech_earnings.
 */
export async function createAgreementVersionAndSyncMirror({
  tech,
  startDate,
  form,
  earningsRecordId = null,
  notes = '',
}) {
  if (!tech?.id) throw new Error('Λείπει τεχνικός')
  const snapshot = formToSnapshot(form)
  const trimmedNotes = String(notes || '').trim()
  if (trimmedNotes) snapshot.agreement_notes = trimmedNotes
  else delete snapshot.agreement_notes

  const { data: version, error: rpcError } = await diasClient.rpc(
    'create_tech_agreement_version',
    {
      p_tech_id: String(tech.id),
      p_start_date: startDate || new Date().toISOString().slice(0, 10),
      p_snapshot: snapshot,
    }
  )
  if (rpcError) throw rpcError

  const payload = earningsToDb(form, tech)
  const query = earningsRecordId
    ? diasClient.from('tech_earnings').update(payload).eq('id', earningsRecordId).select('*').single()
    : diasClient.from('tech_earnings').upsert(payload, { onConflict: 'tech_id' }).select('*').single()

  const { data: earnings, error: earnError } = await query
  if (earnError) throw earnError

  return { version, earnings }
}

/**
 * Αποθήκευση μόνο toggles: Mirror + ενεργό Master snapshot (RPC).
 */
export async function patchActiveAgreementToggles({ techId, form }) {
  if (!techId) throw new Error('Λείπει tech_id')
  const auto = normalizeAutoTransferSettings(form?.auto_transfer_settings)
  const fixed = normalizeFixedExpenseSettings(form?.fixed_expense_settings)

  const { data, error } = await diasClient.rpc('patch_active_agreement_toggles', {
    p_tech_id: String(techId),
    p_auto_transfer_settings: auto,
    p_fixed_expense_settings: fixed,
  })
  if (error) throw error

  // Αν δεν υπάρχει ακόμα ενεργή συμφωνία, ενημέρωσε μόνο το Mirror
  if (!data) {
    const { error: earnError } = await diasClient
      .from('tech_earnings')
      .update({
        auto_transfer_settings: auto,
        fixed_expense_settings: fixed,
        updated_at: new Date().toISOString(),
      })
      .eq('tech_id', String(techId))
    if (earnError) throw earnError
  }

  return data
}
