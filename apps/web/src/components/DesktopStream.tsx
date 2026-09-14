import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Maximize2, RefreshCw } from 'lucide-react'
import type { ComputerLease, User } from '@openstaff/shared'
import { api } from '../lib/api'

export const DESKTOP_STREAM_SRC = '/api/computer/desktop/?autoconnect=1&reconnect=1&view_only=1&resize=scale&show_control_bar=0&path=api%2Fcomputer%2Fdesktop%2Fwebsockify'
const CONTROL_STREAM_SRC = '/api/computer/desktop/?autoconnect=1&reconnect=1&resize=scale&show_control_bar=0&mode=control&path=api%2Fcomputer%2Fdesktop%2Fwebsockify%3Fmode%3Dcontrol'

function remaining(expiresAt: string | null, now: number): string {
  const seconds = Math.max(0, Math.ceil(((expiresAt ? Date.parse(expiresAt) : now) - now) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function DesktopStream({ lease, me, kind = 'proxied' }: { lease: ComputerLease; me: Pick<User, 'id' | 'name' | 'role'>; kind?: 'proxied' | 'external' }) {
  const container = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const [activeLease, setActiveLease] = useState(lease)
  const [key, setKey] = useState(0)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [externalSource, setExternalSource] = useState('')
  const [now, setNow] = useState(Date.now())
  const mine = activeLease.ownerKind === 'human' && activeLease.ownerId === me.id

  useEffect(() => setActiveLease(lease), [lease])
  useEffect(() => {
    if (!mine) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [mine, activeLease.expiresAt])
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
  const label = activeLease.ownerKind === 'bot'
    ? 'Live · Bot in control'
    : mine
      ? `You have control · returns in ${remaining(activeLease.expiresAt, now)}`
      : `${activeLease.ownerName ?? 'Another member'} has control`
  const source = kind === 'external' ? externalSource : mine ? CONTROL_STREAM_SRC : DESKTOP_STREAM_SRC
  const controlClass = 'rounded-md border border-zinc-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50'

  return <div ref={container} className="relative mb-4 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950">
    <div className="border-b border-zinc-700 bg-zinc-900 px-3 py-2 text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 truncate text-xs font-medium"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />{label}</span>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={reconnect} aria-label="Reconnect desktop" className="rounded p-1 text-zinc-300 hover:bg-zinc-800 hover:text-white"><RefreshCw size={14} /></button>
          <button type="button" onClick={() => container.current?.requestFullscreen()} aria-label="Open desktop fullscreen" className="rounded p-1 text-zinc-300 hover:bg-zinc-800 hover:text-white"><Maximize2 size={14} /></button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {activeLease.ownerKind === 'bot' && <button type="button" disabled={busy} onClick={() => void updateLease('take')} className={controlClass}>Take over</button>}
        {mine && <button type="button" disabled={busy} onClick={() => void updateLease('release')} className={controlClass}>Return control</button>}
        {activeLease.ownerKind === 'human' && !mine && me.role === 'owner' && <button type="button" disabled={busy} onClick={() => void updateLease('release', true)} className={controlClass}>Force return</button>}
        {error && <span role="alert" className="truncate text-[11px] text-red-300">{error}</span>}
      </div>
    </div>
    {source
      ? <iframe key={`${key}:${activeLease.epoch}:${mine}`} title="Live Computer desktop" src={source} sandbox={kind === 'proxied' ? 'allow-scripts allow-same-origin' : undefined} allow="clipboard-read; clipboard-write" onError={() => setFailed(true)} className="aspect-[8/5] w-full bg-black" />
      : <div className="grid aspect-[8/5] w-full place-items-center bg-black text-xs text-zinc-400">Connecting to desktop…</div>}
    {failed && <button type="button" onClick={reconnect} className="absolute inset-x-4 bottom-4 rounded-lg bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow">Desktop disconnected. Reconnect</button>}
  </div>
}
