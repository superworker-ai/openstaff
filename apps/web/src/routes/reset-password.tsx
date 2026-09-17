import { useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthCard, AuthError, authButtonClass, authInputClass } from '../components/auth/AuthCard'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>): { token?: string; error?: string } => ({ token: typeof search.token === 'string' ? search.token : undefined, error: typeof search.error === 'string' ? search.error : undefined }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const search = Route.useSearch()
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [error, setError] = useState(search.error ?? ''), [busy, setBusy] = useState(false), [done, setDone] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password !== confirmation) return setError('Passwords do not match')
    if (!search.token) return setError('This reset link is invalid or expired')
    setBusy(true); setError('')
    const result = await authClient.resetPassword({ newPassword: password, token: search.token })
    setBusy(false)
    if (result.error) return setError(result.error.message ?? 'Could not reset password')
    setDone(true)
  }
  return <AuthCard title="Choose a new password">{done ? <><p role="status" className="text-sm text-emerald-700">Your password has been updated.</p><Link to="/login" className="mt-5 block text-sm font-medium underline underline-offset-2">Log in</Link></> : <form onSubmit={submit} className="space-y-3"><input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" className={authInputClass} /><input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Confirm password" className={authInputClass} /><AuthError message={error} /><button disabled={busy || !search.token} className={authButtonClass}>{busy ? 'Updating…' : 'Update password'}</button></form>}</AuthCard>
}
