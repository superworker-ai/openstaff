import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { AuthCard, AuthError, authButtonClass, authInputClass } from '../components/auth/AuthCard'
import { api } from '../lib/api'
import { authClient } from '../lib/auth-client'
import { serverApi } from '../lib/server-api'

interface InvitationDetails {
  invitation: { email: string; workspaceName: string; expiresAt: string; status: 'pending' | 'accepted' | 'revoked' | 'expired' }
}

const loadInvitation = createServerFn({ method: 'GET' }).validator((token: string) => token).handler(({ data }) => serverApi<InvitationDetails>(`/api/invitations/${data}`))

export const Route = createFileRoute('/invite/$token')({
  loader: ({ params }) => loadInvitation({ data: params.token }),
  component: InvitationPage,
  errorComponent: InvitationError,
})

function InvitationError() {
  return <AuthCard title="Invitation unavailable"><p role="alert" className="text-sm text-fg-muted">This invitation link is invalid. Ask the person who invited you to send a new link.</p><Link to="/login" className="mt-5 block text-sm text-fg-muted underline underline-offset-2">Return to login</Link></AuthCard>
}

// Signing up with the invited email settles the invitation server-side, so the link people return to (for example
// from the verification email) is usually already accepted; that is a success, not a dead link.
function SettledInvitation({ invitation, signedIn }: { invitation: InvitationDetails['invitation']; signedIn: boolean }) {
  if (invitation.status === 'accepted') {
    return <AuthCard title={`You're in ${invitation.workspaceName}`} subtitle={`Invitation for ${invitation.email}`}><p role="status" className="text-sm text-fg-muted">This invitation has already been accepted.</p><Link to={signedIn ? '/' : '/login'} className={`${authButtonClass} mt-5 block text-center`}>{signedIn ? 'Open workspace' : 'Log in'}</Link></AuthCard>
  }
  const reason = invitation.status === 'revoked' ? 'This invitation was revoked.' : 'This invitation has expired.'
  return <AuthCard title="Invitation unavailable"><p role="alert" className="text-sm text-fg-muted">{reason} Ask the person who invited you to send a new link.</p><Link to="/login" className="mt-5 block text-sm text-fg-muted underline underline-offset-2">Return to login</Link></AuthCard>
}

function InvitationPage() {
  const { invitation } = Route.useLoaderData()
  const session = authClient.useSession()
  if (invitation.status !== 'pending') return <SettledInvitation invitation={invitation} signedIn={Boolean(session.data?.user)} />
  return <PendingInvitation invitation={invitation} />
}

function PendingInvitation({ invitation }: { invitation: InvitationDetails['invitation'] }) {
  const { token } = Route.useParams(), navigate = useNavigate()
  const session = authClient.useSession()
  const [mode, setMode] = useState<'login' | 'signup'>('signup'), [name, setName] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [verificationSent, setVerificationSent] = useState(false)
  const accept = async () => { await api(`/api/invitations/${token}/accept`, { method: 'POST' }); await navigate({ to: '/' }) }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const result = mode === 'login'
      ? await authClient.signIn.email({ email: invitation.email, password })
      : await authClient.signUp.email({ name, email: invitation.email, password, callbackURL: window.location.href })
    if (result.error) { setBusy(false); return setError(result.error.message ?? 'Could not continue') }
    const current = await authClient.getSession()
    if (!current.data?.user) { setVerificationSent(true); setBusy(false); return }
    try { await accept() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not accept invitation'); setBusy(false) }
  }
  const acceptExisting = async () => {
    setBusy(true); setError('')
    try { await accept() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not accept invitation'); setBusy(false) }
  }
  return <AuthCard title={`Join ${invitation.workspaceName}`} subtitle={`Invitation for ${invitation.email}`}>{verificationSent ? <p role="status" className="text-sm text-ok">Check your email to verify your address, then return to this invitation.</p> : session.data?.user ? <><p className="mb-4 text-sm text-fg-muted">Signed in as {session.data.user.email}</p><AuthError message={error} /><button disabled={busy || session.data.user.email.toLowerCase() !== invitation.email.toLowerCase()} onClick={() => void acceptExisting()} className={authButtonClass}>Accept invitation</button>{session.data.user.email.toLowerCase() !== invitation.email.toLowerCase() && <p className="mt-3 text-sm text-waiting">Sign in as {invitation.email} to accept.</p>}</> : <><div className="mb-4 grid grid-cols-2 rounded-xl bg-surface-3 p-1"><button type="button" onClick={() => setMode('signup')} className={`rounded-lg py-2 ${mode === 'signup' ? 'bg-surface-2 font-medium' : 'text-fg-muted'}`}>Create account</button><button type="button" onClick={() => setMode('login')} className={`rounded-lg py-2 ${mode === 'login' ? 'bg-surface-2 font-medium' : 'text-fg-muted'}`}>Log in</button></div><form onSubmit={submit} className="space-y-3">{mode === 'signup' && <input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" className={authInputClass} />}<input disabled value={invitation.email} aria-label="Email" className={`${authInputClass} bg-surface-4 text-fg-muted`} /><input required minLength={8} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className={authInputClass} /><AuthError message={error} /><button disabled={busy} className={authButtonClass}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account and join' : 'Log in and join'}</button></form><Link to="/login" className="mt-5 block text-sm text-fg-muted underline underline-offset-2">Return to login</Link></>}</AuthCard>
}
