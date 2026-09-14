import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../lib/api'

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
  return <main className="grid min-h-screen place-items-center bg-[#f5f5f3] p-6"><div className="w-full max-w-sm rounded-3xl border border-zinc-200 bg-white p-8"><div className="mb-7 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-black text-lg font-semibold text-white">O</span><div><h1 className="text-xl font-semibold">OpenStaff</h1><p className="text-sm text-zinc-500">Your always-on teammates</p></div></div><div className="mb-5 grid grid-cols-2 rounded-xl bg-zinc-100 p-1"><button onClick={() => setSignup(false)} className={`rounded-lg py-2 ${!signup ? 'bg-white font-medium' : 'text-zinc-500'}`}>Log in</button><button onClick={() => setSignup(true)} className={`rounded-lg py-2 ${signup ? 'bg-white font-medium' : 'text-zinc-500'}`}>Sign up</button></div><form onSubmit={submit} className="space-y-3">{signup && <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" className="w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-zinc-500" />}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-zinc-500" /><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-zinc-500" />{signup && <input value={signupCode} onChange={(event) => setSignupCode(event.target.value)} placeholder="Signup code, if required" className="w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-zinc-500" />}{error && <p className="text-sm text-red-600">{error}</p>}<button disabled={busy} className="w-full rounded-xl bg-black py-3 font-medium text-white">{busy ? 'Please wait…' : signup ? 'Create workspace account' : 'Log in'}</button></form></div></main>
}
