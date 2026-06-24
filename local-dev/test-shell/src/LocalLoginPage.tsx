import { useState } from 'react'
import { useShell } from '@elasticit-llc/shell/hooks'

const TEST_USERS = [
  { label: 'Login as Admin', email: 'admin@localhost', password: 'admin123', role: 'admin' },
  { label: 'Login as User', email: 'user@localhost', password: 'user123', role: 'user (full access)' },
  { label: 'Login as Viewer', email: 'viewer@localhost', password: 'viewer123', role: 'user (viewer)' },
]

export function LocalLoginPage() {
  const { supabase } = useShell()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (email: string, password: string) => {
    setLoading(email)
    setError(null)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) throw authError
      // Honor a deep link the shell's ProtectedRoute saved before bouncing the user
      // to login, so a shared /apps/<id>/<page> link lands on that page after sign-in
      // (mirrors the shell's production LoginPage/AuthCallback). Read inline so it works
      // on any vendored shell version; key matches the shell's returnTo helper. No-op
      // until the shell version that saves the path is vendored.
      let target = '/'
      try {
        const saved = sessionStorage.getItem('shell:returnTo')
        if (saved) {
          sessionStorage.removeItem('shell:returnTo')
          if (saved !== '/' && !saved.startsWith('/login') && !saved.startsWith('/auth/callback')) target = saved
        }
      } catch { /* sessionStorage unavailable — fall back to home */ }
      window.location.href = target
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-shell-950">
      <div className="w-full max-w-sm p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-shell-100">Local Dev Portal</h1>
          <p className="text-sm text-shell-400 mt-1">Select a test user to sign in</p>
        </div>

        <div className="space-y-3">
          {TEST_USERS.map((user) => (
            <button
              key={user.email}
              onClick={() => handleLogin(user.email, user.password)}
              disabled={loading !== null}
              className="w-full px-4 py-3 bg-shell-800 hover:bg-shell-700 border border-shell-700 rounded-lg text-left transition-colors disabled:opacity-50"
            >
              <div className="text-sm font-medium text-shell-100">{user.label}</div>
              <div className="text-xs text-shell-400 mt-0.5">{user.email} &mdash; {user.role}</div>
              {loading === user.email && (
                <div className="text-xs text-brand-400 mt-1">Signing in...</div>
              )}
            </button>
          ))}
        </div>

        {error && (
          <div className="text-sm text-red-400 text-center bg-red-900/20 rounded p-2">
            {error}
          </div>
        )}

        <div className="text-center text-[11px] text-shell-500">
          These are pre-seeded test users for local development only.
        </div>
      </div>
    </div>
  )
}
