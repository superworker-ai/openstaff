import { useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthCard, AuthError, authButtonClass, authInputClass } from '../components/auth/AuthCard'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage })

function ForgotPasswordPage() {
  const [email, setEmail] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` })
    setBusy(false)
    if (result.error) return setError(result.error.message ?? 'Could not send reset email')
    setSent(true)
  }
  return <AuthCard title="Reset your password" subtitle="We will email you a secure reset link">{sent ? <p role="status" className="text-sm text-emerald-700">If an account exists for that email, a reset link is on its way.</p> : <form onSubmit={submit} className="space-y-3"><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className={authInputClass} /><AuthError message={error} /><button disabled={busy} className={authButtonClass}>{busy ? 'Sending…' : 'Send reset link'}</button></form>}<Link to="/login" className="mt-5 block text-sm text-zinc-600 underline underline-offset-2">Back to login</Link></AuthCard>
}
