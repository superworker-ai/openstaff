import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../lib/api'
import { BrandMark } from '../components/BrandMark'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const navigate = useNavigate()
  const [signup, setSignup] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signupCode, setSignupCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', body: JSON.stringify(signup ? { name, email, password, signupCode: signupCode || undefined } : { email, password }) })
      await navigate({ to: '/' })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not sign in') } finally { setBusy(false) }
  }
  const input = 'w-full rounded-md border border-line-strong bg-surface-3 px-4 py-3 text-fg outline-none placeholder:text-fg-subtle focus:border-fg'
  return <main className="grid min-h-screen place-items-center bg-app p-6 text-fg"><div className="w-full max-w-sm rounded-xl border border-line-strong bg-surface-2 p-8 shadow-card"><div className="mb-7 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center text-fg"><BrandMark size={40} /></span><div><h1 className="text-xl font-semibold">OpenStaff</h1><p className="text-sm text-fg-muted">Your always-on teammates</p></div></div><div className="mb-5 grid grid-cols-2 rounded-md bg-surface-3 p-1"><button type="button" onClick={() => setSignup(false)} className={`rounded-sm py-2 ${!signup ? 'bg-surface-4 font-medium text-fg' : 'text-fg-muted'}`}>Log in</button><button type="button" onClick={() => setSignup(true)} className={`rounded-sm py-2 ${signup ? 'bg-surface-4 font-medium text-fg' : 'text-fg-muted'}`}>Sign up</button></div><form onSubmit={submit} className="space-y-3">{signup && <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" className={input} />}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className={input} /><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className={input} />{signup && <input value={signupCode} onChange={(event) => setSignupCode(event.target.value)} placeholder="Signup code, if required" className={input} />}{error && <p className="text-sm text-danger">{error}</p>}<button disabled={busy} className="w-full rounded-md bg-accent py-3 font-medium text-accent-fg hover:opacity-90">{busy ? 'Please wait…' : signup ? 'Create workspace account' : 'Log in'}</button></form></div></main>
}
