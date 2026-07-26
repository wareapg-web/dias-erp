import React, { useState } from 'react'
import { adminClient } from '../lib/supabase'

/**
 * Login στο Admin Supabase project (ίδια credentials με admin-app).
 * Χρειάζεται για RLS σε assignments / daily_status / jobs.
 * Δεν τροποποιεί admin-app ή mobile-app.
 */
export default function AdminLoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: signError } = await adminClient.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signError) {
        setError(
          signError.message === 'Invalid login credentials'
            ? 'Λάθος email ή κωδικός.'
            : signError.message
        )
        return
      }
      onSignedIn?.()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(34,211,238,0.15), transparent 40%), radial-gradient(circle at 80% 70%, rgba(99,102,241,0.2), transparent 45%)',
        }}
      />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md space-y-5 rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl backdrop-blur-md"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400/80">
            DIAS ERP
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">Σύνδεση Admin (Read-Only)</h1>
          <p className="mt-2 text-sm text-slate-400">
            Χρησιμοποίησε τα <strong className="text-slate-200">ίδια</strong> email/κωδικό με το
            admin-app. Χωρίς login το RLS κρύβει assignments &amp; daily_status.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-500/40"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Κωδικός</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-500/40"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2.5 text-sm font-bold text-emerald-100 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500/30 disabled:opacity-50"
        >
          {busy ? 'Σύνδεση...' : 'Σύνδεση'}
        </button>
      </form>
    </div>
  )
}
