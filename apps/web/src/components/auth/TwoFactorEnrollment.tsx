import { useState, type FormEvent } from 'react'
import { authClient } from '../../lib/auth-client'
import { AuthError, authButtonClass, authInputClass } from './AuthCard'
import { QrCodeImage } from './QrCodeImage'

export function TwoFactorEnrollment({ onComplete }: { onComplete: () => void | Promise<void> }) {
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [totpURI, setTotpURI] = useState(''), [backupCodes, setBackupCodes] = useState<string[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const enable = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const result = await authClient.twoFactor.enable({ password, method: 'totp' })
    setBusy(false)
    if (result.error) return setError(result.error.message ?? 'Could not start two-factor setup')
    if (result.data.method === 'totp') { setTotpURI(result.data.totpURI); setBackupCodes(result.data.backupCodes) }
  }
  const verify = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const result = await authClient.twoFactor.verifyTotp({ code: code.replaceAll(' ', '') })
    setBusy(false)
    if (result.error) return setError(result.error.message ?? 'The code was not accepted')
    await onComplete()
  }
  if (!totpURI) return <form onSubmit={enable} className="space-y-3"><p className="text-sm text-zinc-600">Confirm your password to create an authenticator key. Accounts that only use sign-in links can leave it blank.</p><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Current password" className={authInputClass} /><AuthError message={error} /><button disabled={busy} className={authButtonClass}>{busy ? 'Preparing…' : 'Set up authenticator'}</button></form>
  return <div className="space-y-5"><div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-center"><QrCodeImage value={totpURI} /><p className="mt-3 text-sm font-medium">Scan with your authenticator app</p><p className="mt-1 text-xs text-zinc-500">If you cannot scan it, copy the setup URI manually.</p><details className="mt-3"><summary className="text-xs underline">Show setup URI</summary><a href={totpURI} className="mt-2 block break-all rounded-xl bg-white p-3 text-left font-mono text-[11px] underline">{totpURI}</a></details></div><form onSubmit={verify} className="space-y-3"><input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="6-digit code" className={authInputClass} /><AuthError message={error} /><button disabled={busy} className={authButtonClass}>{busy ? 'Verifying…' : 'Verify and enable'}</button></form>{backupCodes.length > 0 && <div className="rounded-2xl bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-950">Save these backup codes now</p><p className="mt-1 text-xs text-amber-800">They are shown only during setup.</p><div className="mt-3 grid grid-cols-2 gap-1 font-mono text-xs text-amber-950">{backupCodes.map((backupCode) => <code key={backupCode}>{backupCode}</code>)}</div></div>}</div>
}
