import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { User } from '@openstaff/shared'
import { api } from '../../lib/api'
import { ErrorText, Section, buttonClass, inputClass, useAction } from './common'

interface Invitation {
  id: string
  email: string
  role: 'admin' | 'member'
  invitedBy: string
  expiresAt: string
  createdAt: string
}

export function Members({ currentUser }: { currentUser: User }) {
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<{ members: User[] }>('/api/members') })
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: () => api<{ invitations: Invitation[] }>('/api/invitations') })
  const action = useAction(), [email, setEmail] = useState(''), [role, setRole] = useState<'admin' | 'member'>('member')
  const refresh = async () => { await Promise.all([members.refetch(), invitations.refetch()]) }
  const invite = async (event: FormEvent) => {
    event.preventDefault()
    await action.run(async () => { await api('/api/invitations', { method: 'POST', body: JSON.stringify({ email, role }) }); setEmail(''); await refresh() })
  }
  const changeRole = (id: string, nextRole: 'admin' | 'member') => action.run(async () => { await api(`/api/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role: nextRole }) }); await refresh() })
  const remove = (id: string) => action.run(async () => { await api(`/api/members/${id}`, { method: 'DELETE' }); await refresh() })
  const ban = (member: User) => { const reason = window.prompt(`Reason for banning ${member.name} (optional)`) ?? undefined; if (reason === undefined) return; void action.run(async () => { await api(`/api/members/${member.id}/ban`, { method: 'POST', body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}) }); await refresh() }) }
  const unban = (id: string) => action.run(async () => { await api(`/api/members/${id}/unban`, { method: 'POST', body: '{}' }); await refresh() })
  const revokeSessions = (member: User) => { if (!window.confirm(`Revoke every active session for ${member.name}?`)) return; void action.run(async () => { await api(`/api/members/${member.id}/revoke-sessions`, { method: 'POST', body: '{}' }); await refresh() }) }
  const transferOwnership = (member: User) => { const confirmation = window.prompt(`Type ${member.name} to transfer workspace ownership`); if (confirmation !== member.name) return; void action.run(async () => { await api(`/api/members/${member.id}/transfer-ownership`, { method: 'POST', body: '{}' }); window.location.reload() }) }
  const revoke = (id: string) => action.run(async () => { await api(`/api/invitations/${id}`, { method: 'DELETE' }); await refresh() })
  return <div className="space-y-5"><Section title="Members"><div className="divide-y divide-zinc-100">{members.data?.members.map((member) => <div key={member.id} className="py-3"><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.name}{member.id === currentUser.id ? ' · You' : ''}{member.banned ? ' · Banned' : ''}</p><p className="truncate text-xs text-zinc-500">{member.email}{member.banReason ? ` · ${member.banReason}` : ''}</p></div>{member.role === 'owner' ? <span className="rounded-lg bg-zinc-100 px-3 py-2 text-sm capitalize">Owner</span> : <><select aria-label={`Role for ${member.name}`} value={member.role} disabled={action.busy} onChange={(event) => void changeRole(member.id, event.target.value as 'admin' | 'member')} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"><option value="member">Member</option><option value="admin">Admin</option></select><button disabled={action.busy || member.id === currentUser.id} onClick={() => void remove(member.id)} className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40">Remove</button></>}</div>{member.role !== 'owner' && <div className="mt-2 flex flex-wrap gap-4 text-xs"><button disabled={action.busy} onClick={() => member.banned ? void unban(member.id) : ban(member)} className={member.banned ? 'text-emerald-700 underline' : 'text-red-600 underline'}>{member.banned ? 'Unban' : 'Ban'}</button><button disabled={action.busy} onClick={() => revokeSessions(member)} className="underline">Revoke sessions</button>{currentUser.role === 'owner' && <button disabled={action.busy} onClick={() => transferOwnership(member)} className="underline">Transfer ownership</button>}</div>}</div>)}</div>{members.isPending && <p className="text-sm text-zinc-500">Loading members…</p>}{members.error && <ErrorText error={members.error.message} />}</Section><Section title="Invite a member"><form onSubmit={invite} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px_auto]"><label className="text-xs font-medium text-zinc-500">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} /></label><label className="text-xs font-medium text-zinc-500">Role<select value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'member')} className={inputClass}><option value="member">Member</option><option value="admin">Admin</option></select></label><button disabled={action.busy} className={`${buttonClass} self-end`}>Send invite</button></form><ErrorText error={action.error} /></Section><Section title="Pending invitations">{invitations.data?.invitations.length ? <div className="divide-y divide-zinc-100">{invitations.data.invitations.map((invitation) => <div key={invitation.id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{invitation.email}</p><p className="text-xs capitalize text-zinc-500">{invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</p></div><button disabled={action.busy} onClick={() => void revoke(invitation.id)} className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40">Revoke</button></div>)}</div> : !invitations.isPending && <p className="text-sm text-zinc-500">No pending invitations.</p>}{invitations.isPending && <p className="text-sm text-zinc-500">Loading invitations…</p>}{invitations.error && <ErrorText error={invitations.error.message} />}</Section></div>
}
