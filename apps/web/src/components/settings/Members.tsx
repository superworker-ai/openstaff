import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { User } from '@openstaff/shared'
import { api } from '../../lib/api'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { ErrorText, Section, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass, useAction } from './common'

interface Invitation {
  id: string
  email: string
  role: 'admin' | 'member'
  invitedBy: string
  expiresAt: string
  createdAt: string
  status: 'pending' | 'expired'
}

interface InviteResult {
  invitation: Invitation
  inviteUrl: string
  delivery: 'email' | 'link'
}

interface Prompt {
  title: string
  body: string
  confirm: string
  label?: string
  expect?: string
  run: (value: string) => Promise<unknown>
}

const policy = { invite: 'invite only', code: 'code', open: 'open' } as const

// Replaces window.prompt/confirm so bans, session revocations, and ownership transfers use the app's dialog.
function PromptDialog({ prompt, busy, onClose }: { prompt: Prompt; busy: boolean; onClose: () => void }) {
  const [value, setValue] = useState('')
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent label={prompt.title} className="p-6">
      <DialogTitle className="text-lg font-semibold">{prompt.title}</DialogTitle>
      <p className="mt-2 text-sm text-fg-muted">{prompt.body}</p>
      {prompt.label && <label className="mt-4 block text-xs font-medium text-fg-muted">{prompt.label}<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} className={inputClass} /></label>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button><button type="button" disabled={busy || (prompt.expect !== undefined && value.trim() !== prompt.expect)} onClick={() => void prompt.run(value.trim()).then(onClose)} className={dangerButtonClass}>{prompt.confirm}</button></div>
    </DialogContent>
  </Dialog>
}

export function Members({ currentUser }: { currentUser: User }) {
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<{ members: User[] }>('/api/members') })
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: () => api<{ invitations: Invitation[] }>('/api/invitations') })
  const authConfig = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ signup: keyof typeof policy }>('/api/auth-config') })
  const action = useAction(), [email, setEmail] = useState(''), [role, setRole] = useState<'admin' | 'member'>('member')
  const [link, setLink] = useState<InviteResult>(), [copied, setCopied] = useState(false), [prompt, setPrompt] = useState<Prompt>()
  const refresh = async () => { await Promise.all([members.refetch(), invitations.refetch()]) }
  const show = (result: InviteResult) => { setLink(result); setCopied(false) }
  const invite = async (event: FormEvent) => {
    event.preventDefault()
    await action.run(async () => { show(await api<InviteResult>('/api/invitations', { method: 'POST', body: JSON.stringify({ email, role }) })); setEmail(''); await refresh() })
  }
  const resend = (id: string) => action.run(async () => { show(await api<InviteResult>(`/api/invitations/${id}/resend`, { method: 'POST', body: '{}' })); await refresh() })
  const changeRole = (id: string, nextRole: 'admin' | 'member') => action.run(async () => { await api(`/api/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role: nextRole }) }); await refresh() })
  const remove = (id: string) => action.run(async () => { await api(`/api/members/${id}`, { method: 'DELETE' }); await refresh() })
  const unban = (id: string) => action.run(async () => { await api(`/api/members/${id}/unban`, { method: 'POST', body: '{}' }); await refresh() })
  const revoke = (id: string) => action.run(async () => { await api(`/api/invitations/${id}`, { method: 'DELETE' }); await refresh() })
  const ban = (member: User) => setPrompt({ title: `Ban ${member.name}`, body: 'They are signed out immediately and cannot sign in again until you unban them.', label: 'Reason, optional', confirm: 'Ban member', run: (reason) => action.run(async () => { await api(`/api/members/${member.id}/ban`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }); await refresh() }) })
  const revokeSessions = (member: User) => setPrompt({ title: 'Revoke sessions', body: `Sign ${member.name} out of every active session?`, confirm: 'Revoke sessions', run: () => action.run(async () => { await api(`/api/members/${member.id}/revoke-sessions`, { method: 'POST', body: '{}' }); await refresh() }) })
  const transferOwnership = (member: User) => setPrompt({ title: 'Transfer ownership', body: `${member.name} becomes the workspace owner and you become an administrator.`, label: `Type ${member.name} to confirm`, expect: member.name, confirm: 'Transfer ownership', run: () => action.run(async () => { await api(`/api/members/${member.id}/transfer-ownership`, { method: 'POST', body: '{}' }); window.location.reload() }) })
  const expiry = (invitation: Invitation) => `${invitation.status === 'expired' ? 'expired' : 'expires'} ${new Date(invitation.expiresAt).toLocaleDateString()}`
  return <div className="space-y-5"><Section title="Members"><p className="mb-4 text-sm text-fg-muted">Sign-up: {authConfig.data ? policy[authConfig.data.signup] : '…'}. Set <code>AUTH_SIGNUP</code> to <code>open</code>, <code>code</code>, or <code>invite</code> to change it.</p><div className="divide-y divide-line">{members.data?.members.map((member) => <div key={member.id} className="py-3"><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.name}{member.id === currentUser.id ? ' · You' : ''}{member.banned ? ' · Banned' : ''}</p><p className="truncate text-xs text-fg-muted">{member.email}{member.banReason ? ` · ${member.banReason}` : ''}</p></div>{member.role === 'owner' ? <span className="rounded-lg bg-surface-3 px-3 py-2 text-sm capitalize">Owner</span> : <><select aria-label={`Role for ${member.name}`} value={member.role} disabled={action.busy} onChange={(event) => void changeRole(member.id, event.target.value as 'admin' | 'member')} className="rounded-lg border border-line-strong bg-surface-3 px-3 py-2 text-sm text-fg"><option value="member">Member</option><option value="admin">Admin</option></select><button disabled={action.busy || member.id === currentUser.id} onClick={() => void remove(member.id)} className="rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-40">Remove</button></>}</div>{member.role !== 'owner' && member.id !== currentUser.id && <div className="mt-2 flex flex-wrap gap-4 text-xs"><button disabled={action.busy} onClick={() => member.banned ? void unban(member.id) : ban(member)} className={member.banned ? 'text-ok underline' : 'text-danger underline'}>{member.banned ? 'Unban' : 'Ban'}</button><button disabled={action.busy} onClick={() => revokeSessions(member)} className="underline">Revoke sessions</button>{currentUser.role === 'owner' && <button disabled={action.busy} onClick={() => transferOwnership(member)} className="underline">Transfer ownership</button>}</div>}</div>)}</div>{members.isPending && <p className="text-sm text-fg-muted">Loading members…</p>}{members.error && <ErrorText error={members.error.message} />}</Section><Section title="Invite a member"><form onSubmit={invite} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px_auto]"><label className="text-xs font-medium text-fg-muted">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} /></label><label className="text-xs font-medium text-fg-muted">Role<select value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'member')} className={inputClass}><option value="member">Member</option><option value="admin">Admin</option></select></label><button disabled={action.busy} className={`${buttonClass} self-end`}>Send invite</button></form>{link && <div className="mt-4 rounded-md border border-line-strong bg-surface-3 p-4"><p className="text-sm font-medium">Invitation link for {link.invitation.email}</p><p className="mt-2 break-all font-mono text-xs text-fg-muted">{link.inviteUrl}</p>{link.delivery === 'link' && <p className="mt-2 text-xs text-waiting">Email is not configured. Send this link to {link.invitation.email} yourself.</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { void navigator.clipboard.writeText(link.inviteUrl); setCopied(true) }} className={secondaryButtonClass}>{copied ? 'Copied' : 'Copy link'}</button><button type="button" onClick={() => setLink(undefined)} className={secondaryButtonClass}>Dismiss</button></div></div>}<ErrorText error={action.error} /></Section><Section title="Invitations">{invitations.data?.invitations.length ? <div className="divide-y divide-line">{invitations.data.invitations.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{invitation.email}{invitation.status === 'expired' ? ' · Expired' : ''}</p><p className="text-xs capitalize text-fg-muted">{invitation.role} · {expiry(invitation)}</p></div><button disabled={action.busy} onClick={() => void resend(invitation.id)} className={secondaryButtonClass}>Resend</button><button disabled={action.busy} onClick={() => void revoke(invitation.id)} className={dangerButtonClass}>Revoke</button></div>)}</div> : !invitations.isPending && <p className="text-sm text-fg-muted">No open invitations.</p>}{invitations.isPending && <p className="text-sm text-fg-muted">Loading invitations…</p>}{invitations.error && <ErrorText error={invitations.error.message} />}</Section>{prompt && <PromptDialog prompt={prompt} busy={action.busy} onClose={() => setPrompt(undefined)} />}</div>
}
