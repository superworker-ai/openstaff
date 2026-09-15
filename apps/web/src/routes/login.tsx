import { useRef, useState, type FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AuthCard, AuthError, authButtonClass, authInputClass } from '../components/auth/AuthCard'
import { authClient } from '../lib/auth-client'
import { loadAuthConfig } from '../lib/loaders'

export const Route = createFileRoute('/login')({ loader: () => loadAuthConfig(), component: LoginPage })

function LoginPage() {
  const config = Route.useLoaderData(), navigate = useNavigate()
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [signupCode, setSignupCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [ssoRequired, setSsoRequired] = useState(false), [ssoFound, setSsoFound] = useState(false)
  const checkedEmail = useRef('')
  const trySso = async () => {
    const normalized = email.trim().toLowerCase()
    if (!config.sso || !normalized) return false
    setBusy(true); setError('')
    const result = await authClient.signIn.sso({ email: normalized, callbackURL: '/', errorCallbackURL: '/login' })
    setBusy(false)
    if (result.error) {
      const message = result.error.message ?? ''
      if (result.error.status === 404 || /no sso provider|provider not found/i.test(message)) { setSsoFound(false); return false }
      setError(message || 'Could not start single sign-on'); return true
    }
    setSsoFound(true)
    if (result.data?.url) window.location.assign(result.data.url)
    return true
  }
  const discoverSso = async () => {
    const normalized = email.trim().toLowerCase()
    if (!normalized || normalized === checkedEmail.current) return
    checkedEmail.current = normalized
    await trySso()
  }
  const passwordLogin = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    if (await trySso()) return
    setBusy(true)
    const result = await authClient.signIn.email({ email, password })
    setBusy(false)
    if (result.error) {
      if (result.error.code === 'sso_required') { setSsoRequired(true); setSsoFound(true); return setError('Your organisation requires single sign-on') }
      return setError(result.error.message ?? 'Could not sign in')
    }
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
  return <AuthCard title="Log in" subtitle="Welcome back to your workspace"><form onSubmit={passwordLogin} className="space-y-3"><input required type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setSsoRequired(false); setSsoFound(false); checkedEmail.current = '' }} onBlur={() => void discoverSso()} placeholder="Email" className={authInputClass} />{config.sso && (ssoFound || ssoRequired) && <button type="button" disabled={busy || !email} onClick={() => void trySso()} className={authButtonClass}>{busy ? 'Opening…' : 'Continue with single sign-on'}</button>}{!ssoRequired && <>{config.password && <><input required minLength={8} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className={authInputClass} /><button disabled={busy} className={authButtonClass}>{busy ? 'Please wait…' : 'Log in'}</button></>}{config.magicLink && <>{config.signup === 'code' && <input value={signupCode} onChange={(event) => setSignupCode(event.target.value)} placeholder="Signup code for a new account" className={authInputClass} />}<button type="button" disabled={busy || !email} onClick={() => void magicLogin()} className="w-full rounded-xl border border-zinc-300 py-3 font-medium disabled:opacity-50">Email me a sign-in link</button></>}{config.socialProviders.length > 0 && <div className="space-y-2 border-t border-zinc-100 pt-3">{config.socialProviders.map((provider) => <button key={provider} type="button" disabled={busy} onClick={() => void authClient.signIn.social({ provider: provider as 'google' | 'github' | 'microsoft', callbackURL: '/' })} className="w-full rounded-xl border border-zinc-300 py-3 font-medium capitalize">Continue with {provider}</button>)}</div>}</>}<AuthError message={error} />{sent && <p role="status" className="text-sm text-emerald-700">Check your email for a sign-in link.</p>}</form>{!ssoRequired && <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">{config.password && <Link to="/forgot-password" className="text-zinc-600 underline underline-offset-2">Forgot password?</Link>}{signupAllowed && <Link to="/signup" className="font-medium underline underline-offset-2">Create account</Link>}</div>}</AuthCard>
}
