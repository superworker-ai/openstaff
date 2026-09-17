import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AuthCard, AuthError, authButtonClass, authInputClass } from '../components/auth/AuthCard'
import { authClient } from '../lib/auth-client'

export const Route = createFileRoute('/two-factor')({ component: TwoFactorPage })

function TwoFactorPage() {
  const navigate = useNavigate()
  const [code, setCode] = useState(''), [backup, setBackup] = useState(false), [trustDevice, setTrustDevice] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const normalized = backup ? code.trim() : code.replaceAll(' ', '')
    const result = backup ? await authClient.twoFactor.verifyBackupCode({ code: normalized, trustDevice }) : await authClient.twoFactor.verifyTotp({ code: normalized, trustDevice })
    setBusy(false)
    if (result.error) return setError(result.error.message ?? 'The code was not accepted')
    await navigate({ to: '/' })
  }
  return <AuthCard title="Two-factor verification" subtitle={backup ? 'Enter one of your recovery codes' : 'Enter the code from your authenticator'}><form onSubmit={submit} className="space-y-3"><input required autoFocus inputMode={backup ? 'text' : 'numeric'} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder={backup ? 'Backup code' : '6-digit code'} className={authInputClass} /><label className="flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={trustDevice} onChange={(event) => setTrustDevice(event.target.checked)} />Trust this device for 30 days</label><AuthError message={error} /><button disabled={busy} className={authButtonClass}>{busy ? 'Verifying…' : 'Continue'}</button></form><button type="button" onClick={() => { setBackup((value) => !value); setCode(''); setError('') }} className="mt-4 text-sm underline underline-offset-2">{backup ? 'Use an authenticator code' : 'Use a backup code'}</button><Link to="/login" className="mt-4 block text-sm text-zinc-500">Back to login</Link></AuthCard>
}
