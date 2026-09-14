import { useEffect, useState } from 'react'
import { connectionPath, type Approval } from '@openstaff/shared'
import { api } from '../lib/api'
import { onConnectionMessage, openConnectionPopup } from '../lib/connection-popup'
import { useConnectedApps } from '../hooks/useConnectedApps'
import { ComposioConnect } from './ComposioConnect'

export function ConnectCard({ approval, onUpdate }: { approval: Approval; onUpdate: (approval: Approval) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const connection = approval.connection!
  const apps = useConnectedApps()
  const [connected, setConnected] = useState(false)
  useEffect(() => onConnectionMessage((message) => { if (message.approvalId === approval.id) setConnected(true) }), [approval.id])
  const deny = async () => {
    setBusy(true)
    try { const result = await api<{ approval: Approval }>(`/api/approvals/${approval.id}`, { method: 'POST', body: JSON.stringify({ decision: 'deny', reason: 'The human chose Not now. Explain that the app is not connected.' }) }); onUpdate(result.approval) }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not update request') }
    finally { setBusy(false) }
  }
  return <div data-testid="connect-card" className="mx-auto mb-5 max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><p className="font-medium text-zinc-900">{approval.summary}</p><p className="mt-2 text-sm text-zinc-500">Sign in to continue this conversation. Your teammate will pick up where it left off.</p>{approval.status === 'pending' && !connected ? <div className="mt-4 flex items-center gap-4"><div>{connection.source === 'composio' ? <ComposioConnect toolkit={connection.toolkit!} approvalId={approval.id} configured={apps.data?.configured ?? false} label={apps.data?.configured ? `Connect ${connection.appName}` : 'Connect with Composio'} /> : <button onClick={() => { try { openConnectionPopup(connectionPath(connection, approval.id)) } catch (error) { setError((error as Error).message) } }} className="rounded-lg bg-black px-4 py-2 text-sm text-white active:scale-[.97]">{approval.resumeMode === 'retry' ? 'Reconnect' : 'Connect'} {connection.appName}</button>}</div><button disabled={busy} onClick={deny} className="text-sm text-zinc-500">Not now</button></div> : <p className="mt-4 text-sm text-zinc-600">{(connected || approval.status === 'approved') ? 'Connected · Continuing conversation' : approval.status === 'denied' ? 'Not connected · Request declined' : 'Connection request expired'}</p>}{error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}</div>
}
