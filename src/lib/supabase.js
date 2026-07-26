import { createClient } from '@supabase/supabase-js'

// =========================================================================
// ΚΑΛΩΔΙΟ 1: Admin App (READ-ONLY)
// Ίδιο project με admin-app. Τα assignments/daily_status/jobs απαιτούν
// authenticated session (RLS) — γι' αυτό κάνουμε login εδώ, ΧΩΡΙΣ να
// αλλάζουμε admin-app / mobile-app.
// =========================================================================
const adminSupabaseUrl = import.meta.env.VITE_ADMIN_SUPABASE_URL
const adminSupabaseKey = import.meta.env.VITE_ADMIN_SUPABASE_ANON_KEY

export const adminClient = createClient(adminSupabaseUrl, adminSupabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'dias-erp-admin-auth',
  },
})

// =========================================================================
// ΚΑΛΩΔΙΟ 2: DIAS ERP (READ & WRITE) — ξεχωριστό project
// =========================================================================
const diasSupabaseUrl = import.meta.env.VITE_DIAS_SUPABASE_URL
const diasSupabaseKey = import.meta.env.VITE_DIAS_SUPABASE_ANON_KEY

export const diasClient = createClient(diasSupabaseUrl, diasSupabaseKey, {
  auth: {
    persistSession: true,
    storageKey: 'dias-erp-dias-auth',
  },
})

/** Paginated select — same pattern as admin-app fetchAllRows */
export async function fetchAllRows(client, table, buildQuery) {
  const allRows = []
  let offset = 0
  const limit = 1000
  while (true) {
    let query = client.from(table).select('*').range(offset, offset + limit - 1)
    if (buildQuery) query = buildQuery(query)
    const { data, error } = await query
    if (error) throw error
    const batch = data ?? []
    if (!batch.length) break
    allRows.push(...batch)
    if (batch.length < limit) break
    offset += limit
  }
  return allRows
}

export function isMissingTableError(error) {
  if (!error) return false
  const code = String(error.code || '')
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('does not exist'))
  )
}

export function formatSupabaseError(error, { table, clientLabel = 'Supabase' } = {}) {
  if (!error) return null
  if (isMissingTableError(error)) {
    return table
      ? `Ο πίνακας «${table}» δεν υπάρχει ακόμη στο ${clientLabel}. Δημιουργήστε τον για να ενεργοποιηθεί η λειτουργία.`
      : `Λείπει πίνακας στο ${clientLabel}. Ελέγξτε το schema της βάσης.`
  }
  return error.message || String(error)
}

export async function safeQuery(promise, { table, clientLabel } = {}) {
  try {
    const result = await promise
    if (result?.error) {
      return {
        data: [],
        error: formatSupabaseError(result.error, { table, clientLabel }),
        missing: isMissingTableError(result.error),
        rawError: result.error,
      }
    }
    return { data: result?.data ?? [], error: null, missing: false, rawError: null }
  } catch (err) {
    return {
      data: [],
      error: formatSupabaseError(err, { table, clientLabel }),
      missing: isMissingTableError(err),
      rawError: err,
    }
  }
}
