import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { AuthCard, AuthError, authButtonClass, authInputClass } from '../components/auth/AuthCard'
import { authClient } from '../lib/auth-client'
import { loadAuthConfig } from '../lib/loaders'

export const Route = createFileRoute('/signup')({
  loader: async () => { const config = await loadAuthConfig(); if (config.signup === 'invite') throw redirect({ to: '/login' }); return config },
  component: SignupPage,
})

function SignupPage() {
  const config = Route.useLoaderData(), navigate = useNavigate()
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [signupCode, setSignupCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const result = await authClient.signUp.email({ name, email, password, callbackURL: '/verify-email' }, signupCode ? { headers: { 'x-signup-code': signupCode } } : undefined)
    setBusy(false)
    if (result.error) return setError(result.error.message ?? 'Could not create account')
    if (config.emailVerification) return setSent(true)
    await navigate({ to: '/' })
  }
  return <AuthCard title="Create your account" subtitle="Join this OpenStaff workspace">{sent ? <><p role="status" className="text-sm text-emerald-700">Check your email to verify your address.</p><Link to="/login" className="mt-5 block text-sm font-medium underline underline-offset-2">Back to login</Link></> : <form onSubmit={submit} className="space-y-3"><input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" className={authInputClass} /><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className={authInputClass} /><input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className={authInputClass} />{config.signup === 'code' && <input required value={signupCode} onChange={(event) => setSignupCode(event.target.value)} placeholder="Signup code" className={authInputClass} />}<AuthError message={error} /><button disabled={busy} className={authButtonClass}>{busy ? 'Creating account…' : 'Create account'}</button><Link to="/login" className="block text-center text-sm text-zinc-600 underline underline-offset-2">Already have an account?</Link></form>}</AuthCard>
}
