import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { openConnectionPopup } from '../lib/connection-popup'
import { buttonClass, inputClass } from './settings/common'

export function ComposioConnect({ toolkit, configured, approvalId, label = 'Connect with Composio', standalone = false, onConfigured }: { toolkit: string; configured: boolean; approvalId?: string; label?: string; standalone?: boolean; onConfigured?: () => void }) {
  const [editing, setEditing] = useState(false), [key, setKey] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const client = useQueryClient()
  const connect = async () => {
    setError('')
    let popup: Window | undefined
    try {
      popup = standalone ? window : openConnectionPopup()
      setBusy(true)
      if (!configured) { await api('/api/workspace/provider-keys', { method: 'PUT', body: JSON.stringify({ composio: key.trim() }) }); setKey(''); onConfigured?.(); await client.invalidateQueries({ queryKey: ['connection-apps'] }) }
      popup.location.href = `/api/connections/start?toolkit=${encodeURIComponent(toolkit)}${approvalId ? `&approval=${encodeURIComponent(approvalId)}` : ''}`
    } catch (error) { if (!standalone) popup?.close(); setError(error instanceof Error ? error.message : 'Could not connect') }
    finally { setBusy(false) }
  }
  return <div>{!configured && editing ? <form className="space-y-3 text-sm" onSubmit={(event) => { event.preventDefault(); void connect() }}><p>1. <a href="https://platform.composio.dev" target="_blank" rel="noreferrer" className="underline">Get a Composio key</a></p><label className="block">2. Paste your key<input required type="password" autoComplete="new-password" aria-label="Composio key" className={inputClass} value={key} onChange={(event) => setKey(event.target.value)} /></label><button disabled={busy || !key.trim()} className={buttonClass}>Save and connect</button></form> : <button disabled={busy} className={buttonClass} onClick={() => configured ? void connect() : setEditing(true)}>{label}</button>}{error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}</div>
}
