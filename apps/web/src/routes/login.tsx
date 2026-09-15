import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AuthCard, AuthError, authButtonClass, authInputClass } from '../components/auth/AuthCard'
import { authClient } from '../lib/auth-client'
import { loadAuthConfig } from '../lib/loaders'

export const Route = createFileRoute('/login')({ loader: () => loadAuthConfig(), component: LoginPage })

function LoginPage() {
  const config = Route.useLoaderData(), navigate = useNavigate()
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [signupCode, setSignupCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false)
  const passwordLogin = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const result = await authClient.signIn.email({ email, password })
    setBusy(false)
    if (result.error) return setError(result.error.message ?? 'Could not sign in')
    await navigate({ to: '/' })
  }
  const magicLogin = async () => {
    setBusy(true); setError('')
    const result = await authClient.signIn.magicLink({ email, callbackURL: '/' }, signupCode ? { headers: { 'x-signup-code': signupCode } } : undefined)
    setBusy(false)
    if (result.error) return setError(result.error.message ?? 'Could not send the link')
    setSent(true)
  }
  const signupAllowed = config.signup === 'open' || config.signup === 'code'
  return <AuthCard title="Log in" subtitle="Welcome back to your workspace"><form onSubmit={passwordLogin} className="space-y-3"><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className={authInputClass} />{config.password && <><input required minLength={8} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className={authInputClass} /><button disabled={busy} className={authButtonClass}>{busy ? 'Please wait…' : 'Log in'}</button></>}{config.magicLink && <>{config.signup === 'code' && <input value={signupCode} onChange={(event) => setSignupCode(event.target.value)} placeholder="Signup code for a new account" className={authInputClass} />}<button type="button" disabled={busy || !email} onClick={() => void magicLogin()} className="w-full rounded-xl border border-zinc-300 py-3 font-medium disabled:opacity-50">Email me a sign-in link</button></>}<AuthError message={error} />{sent && <p role="status" className="text-sm text-emerald-700">Check your email for a sign-in link.</p>}</form><div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">{config.password && <Link to="/forgot-password" className="text-zinc-600 underline underline-offset-2">Forgot password?</Link>}{signupAllowed && <Link to="/signup" className="font-medium underline underline-offset-2">Create account</Link>}</div></AuthCard>
}
