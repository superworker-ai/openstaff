import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { loadMe } from '../lib/loaders'
import { openConnectionPopup } from '../lib/connection-popup'
import { ScopePicker } from './ConnectScope'
import { buttonClass, inputClass } from './settings/common'

export function ComposioConnect({ toolkit, configured, approvalId, label = 'Connect with Composio', standalone = false, scope: fixedScope, picker = false, disabled = false, onConfigured }: { toolkit: string; configured: boolean; approvalId?: string; label?: string; standalone?: boolean; scope?: 'member' | 'workspace'; picker?: boolean; disabled?: boolean; onConfigured?: () => void }) {
  const [editing, setEditing] = useState(false), [key, setKey] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [scope, setScope] = useState<'member' | 'workspace'>(fixedScope ?? 'member')
  const client = useQueryClient()
  // Saving a key is owner-only, so members get the ask instead of a form that would 403.
  const me = useQuery({ queryKey: ['me'], queryFn: () => loadMe(), staleTime: 60_000 })
  const member = me.data ? me.data.user.role !== 'owner' : false
  // Only owners and admins may connect an app on everyone's behalf, so members never see the choice.
  const canPick = picker && !fixedScope && Boolean(me.data && me.data.user.role !== 'member')
  const connect = async () => {
    setError('')
    let popup: Window | undefined
    try {
      popup = standalone ? window : openConnectionPopup()
      setBusy(true)
      if (!configured) { await api('/api/workspace/provider-keys', { method: 'PUT', body: JSON.stringify({ composio: key.trim() }) }); setKey(''); onConfigured?.(); await client.invalidateQueries({ queryKey: ['connection-apps'] }) }
      popup.location.href = `/api/connections/start?toolkit=${encodeURIComponent(toolkit)}${approvalId ? `&approval=${encodeURIComponent(approvalId)}` : ''}&scope=${fixedScope ?? scope}`
    } catch (error) { if (!standalone) popup?.close(); setError(error instanceof Error ? error.message : 'Could not connect') }
    finally { setBusy(false) }
  }
  return <div>{!configured && editing ? member ? <p className="text-sm text-fg-muted">Ask the workspace owner to add a Composio API key in Settings → Providers</p> : <form className="space-y-3 text-sm" onSubmit={(event) => { event.preventDefault(); void connect() }}><p>1. <a href="https://platform.composio.dev" target="_blank" rel="noreferrer" className="underline">Get a Composio key</a></p><label className="block">2. Paste your key<input required type="password" autoComplete="new-password" aria-label="Composio key" className={inputClass} value={key} onChange={(event) => setKey(event.target.value)} /></label><button disabled={busy || !key.trim()} className={buttonClass}>Save and connect</button></form> : <div className="flex flex-wrap items-center gap-2">{canPick && <ScopePicker value={scope} onChange={setScope} disabled={busy || disabled} />}<button disabled={busy || disabled} className={buttonClass} onClick={() => configured ? void connect() : setEditing(true)}>{label}</button></div>}{error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}</div>
}
