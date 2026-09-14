import { useState } from 'react'
import { appSlug } from '@openstaff/shared'
import type { RoomView } from '../lib/loaders'
import { connectRoomApp } from '../lib/connection-popup'
import { useConnectedApps } from '../hooks/useConnectedApps'

export function RoomApps({ room }: { room: RoomView }) {
  const query = useConnectedApps(), [error, setError] = useState('')
  const suggestions = room.members.flatMap((member) => member.entity && 'job' in member.entity ? member.entity.suggestedApps ?? [] : []).map(appSlug)
  const apps = query.data?.apps.filter((app) => suggestions.includes(app.slug) || app.source === 'mcp' || app.status !== 'not connected') ?? []
  const connect = async (app: string) => { try { setError(''); await connectRoomApp(room.id, app) } catch (error) { setError((error as Error).message) } }
  return <section aria-label="Room apps" className="mt-5"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Apps</h3><div className="flex flex-wrap gap-2">{apps.map((app) => <button key={app.slug} disabled={app.status === 'connected'} title={`${app.appName} · ${app.status}`} aria-label={`${app.appName} · ${app.status}`} onClick={() => void connect(app.slug)} className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-600">{app.logo ? <img src={app.logo} alt="" className="h-5 w-5 rounded object-contain" /> : <span className="grid h-5 w-5 place-items-center rounded bg-zinc-100 font-semibold">{app.appName[0]}</span>}{app.appName}<span data-status={app.status} className={`h-1.5 w-1.5 rounded-full ${app.status === 'connected' ? 'bg-emerald-500' : app.status === 'expired' ? 'bg-amber-500' : 'bg-zinc-300'}`} /></button>)}</div>{!apps.length && <p className="text-xs text-zinc-400">Connect an app with /connect</p>}{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}</section>
}
