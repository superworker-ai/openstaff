import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ComputerLease, User } from '@openstaff/shared'
import { api } from '../lib/api'

export const DESKTOP_STREAM_SRC = '/api/computer/desktop/?autoconnect=1&reconnect=1&view_only=1&resize=scale&show_control_bar=0&path=api%2Fcomputer%2Fdesktop%2Fwebsockify'
const CONTROL_STREAM_SRC = '/api/computer/desktop/?autoconnect=1&reconnect=1&resize=scale&show_control_bar=0&mode=control&path=api%2Fcomputer%2Fdesktop%2Fwebsockify%3Fmode%3Dcontrol'

export interface DesktopStreamHandle {
  reconnect: () => Promise<void>
}

interface LeaseControlsProps {
  lease: ComputerLease
  me: Pick<User, 'id' | 'name' | 'role'>
  busy: boolean
  error: string
  onUpdateLease: (action: 'take' | 'release', force?: boolean) => void
}

export function LeaseControls({ lease, me, busy, error, onUpdateLease }: LeaseControlsProps) {
  const mine = lease.ownerKind === 'human' && lease.ownerId === me.id
  return <div className="activity-lease">
    <div>
      {lease.ownerKind === 'bot' && <button type="button" disabled={busy} onClick={() => onUpdateLease('take')}>Take over</button>}
      {mine && <button type="button" disabled={busy} onClick={() => onUpdateLease('release')}>Return control</button>}
      {lease.ownerKind === 'human' && !mine && me.role === 'owner' && <button type="button" disabled={busy} onClick={() => onUpdateLease('release', true)}>Force return</button>}
    </div>
    {mine && <p>Your input goes straight to the computer. Control returns automatically.</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}

interface DesktopStreamProps {
  lease: ComputerLease
  me: Pick<User, 'id' | 'name' | 'role'>
  kind?: 'proxied' | 'external'
  renderOverlay: (leaseControls: ReactNode) => ReactNode
}

export const DesktopStream = forwardRef<DesktopStreamHandle, DesktopStreamProps>(function DesktopStream({ lease, me, kind = 'proxied', renderOverlay }, ref) {
  const queryClient = useQueryClient()
  const [activeLease, setActiveLease] = useState(lease)
  const [key, setKey] = useState(0)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [externalSource, setExternalSource] = useState('')
  const mine = activeLease.ownerKind === 'human' && activeLease.ownerId === me.id

  useEffect(() => setActiveLease(lease), [lease])
  useEffect(() => {
    if (!mine) return
    const timer = setInterval(() => {
      void api<ComputerLease>('/api/computer/lease/heartbeat', { method: 'POST', body: '{}' })
        .then(setActiveLease)
        .catch(() => { setError('Control heartbeat failed'); void queryClient.invalidateQueries({ queryKey: ['computer-status'] }) })
    }, 30_000)
    return () => clearInterval(timer)
  }, [mine, activeLease.epoch, queryClient])
  useEffect(() => {
    if (kind !== 'external') { setExternalSource(''); return }
    const controller = new AbortController()
    setExternalSource('')
    setFailed(false)
    void api<{ kind: 'viewer' | 'control'; url: string }>(`/api/computer/desktop/session?mode=${mine ? 'control' : 'viewer'}`, { signal: controller.signal })
      .then((session) => setExternalSource(session.url))
      .catch((reason) => { if (!controller.signal.aborted) { setFailed(true); setError(reason instanceof Error ? reason.message : 'Desktop session failed') } })
    return () => controller.abort()
  }, [kind, activeLease.epoch, mine, key])

  const reconnect = () => { setFailed(false); setKey((value) => value + 1) }
  // External streams (E2B) authenticate with a per-process key; rotating it on Reconnect recovers
  // "password check failed" after a server restart or an outside stream restart.
  const reconnectExternal = async () => {
    if (kind !== 'external') return reconnect()
    setBusy(true); setError('')
    try { await api('/api/computer/desktop/session/rotate', { method: 'POST', body: '{}' }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Stream refresh failed') }
    finally { setBusy(false); reconnect() }
  }
  useImperativeHandle(ref, () => ({ reconnect: reconnectExternal }))
  const updateLease = async (action: 'take' | 'release', force = false) => {
    setBusy(true); setError('')
    try {
      const next = await api<ComputerLease>(`/api/computer/lease/${action}`, { method: 'POST', body: JSON.stringify(force ? { force: true } : {}) })
      setActiveLease(next)
      reconnect()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['computer-status'] }),
        queryClient.invalidateQueries({ queryKey: ['computer-lease'] }),
      ])
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Control request failed') }
    finally { setBusy(false) }
  }
  const source = kind === 'external' ? externalSource : mine ? CONTROL_STREAM_SRC : DESKTOP_STREAM_SRC

  return <div className="absolute inset-0 overflow-hidden bg-screen">
    {source
      ? <iframe key={`${key}:${activeLease.epoch}:${mine}`} title="Live Computer desktop" src={source} sandbox={kind === 'proxied' ? 'allow-scripts allow-same-origin' : undefined} allow="clipboard-read; clipboard-write" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full bg-black" />
      : <div className="absolute inset-0 grid place-items-center bg-black text-xs text-fg-muted">Connecting to desktop…</div>}
    {renderOverlay(<LeaseControls lease={activeLease} me={me} busy={busy} error={error} onUpdateLease={(action, force) => void updateLease(action, force)} />)}
    {failed && <button type="button" onClick={() => void reconnectExternal()} className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-md bg-accent px-4 py-2 text-xs font-medium text-accent-fg shadow">Desktop disconnected. Reconnect</button>}
  </div>
})
