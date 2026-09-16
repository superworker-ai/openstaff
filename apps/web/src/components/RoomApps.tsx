import { useState } from 'react'
import { appSlug, type ConnectedApp } from '@openstaff/shared'
import type { RoomView } from '../lib/loaders'
import { connectRoomApp } from '../lib/connection-popup'
import { useConnectedApps } from '../hooks/useConnectedApps'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

function AppLogo({ app }: { app: ConnectedApp }) {
  return app.logo
    ? <img src={app.logo} alt="" className="h-5 w-5 rounded object-contain" />
    : <span className="grid h-5 w-5 place-items-center rounded bg-surface-4 text-[10px] font-semibold text-fg">{app.appName[0]}</span>
}

function StatusDot({ app }: { app: ConnectedApp }) {
  return <span data-status={app.status} className={`h-1.5 w-1.5 shrink-0 rounded-full ${app.status === 'connected' ? 'bg-ok' : app.status === 'expired' ? 'bg-waiting' : 'bg-fg-subtle'}`} />
}

export function RoomApps({ room }: { room: RoomView }) {
  const query = useConnectedApps(), [error, setError] = useState('')
  const suggestions = room.members.flatMap((member) => member.entity && 'job' in member.entity ? member.entity.suggestedApps ?? [] : []).map(appSlug)
  const apps = query.data?.apps.filter((app) => suggestions.includes(app.slug) || app.source === 'mcp' || app.status !== 'not connected') ?? []
  const connect = async (app: string) => {
    try { setError(''); await connectRoomApp(room.id, app) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not connect app') }
  }
  const visible = apps.slice(0, 5), remaining = apps.slice(5)
  return <section aria-label="Room apps" className="relative flex items-center gap-2">
    {apps.length > 0 && <div className="flex h-8 items-center gap-1 rounded-lg border border-line bg-surface-2 px-1.5 shadow-card">
      {visible.map((app) => <button type="button" key={app.slug} disabled={app.status === 'connected'} title={`${app.appName} · ${app.status}`} aria-label={`${app.appName} · ${app.status}`} onClick={() => void connect(app.slug)} className="relative grid h-7 w-7 place-items-center rounded-md hover:bg-surface-3"><AppLogo app={app} /><span className="absolute bottom-0.5 right-0.5"><StatusDot app={app} /></span></button>)}
      {remaining.length > 0 && <Popover>
        <PopoverTrigger asChild><button type="button" aria-label={`${remaining.length} more apps`} className="h-7 rounded-md px-1.5 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg">+{remaining.length}</button></PopoverTrigger>
        <PopoverContent label="More room apps" portalled={false} align="end" className="w-64 p-2">
          <div className="space-y-1">{remaining.map((app) => <button type="button" key={app.slug} disabled={app.status === 'connected'} title={`${app.appName} · ${app.status}`} aria-label={`${app.appName} · ${app.status}`} onClick={() => void connect(app.slug)} className="flex w-full items-center gap-2 rounded-md border border-line bg-surface-3 px-2.5 py-2 text-left text-xs text-fg-muted hover:bg-surface-4 hover:text-fg"><AppLogo app={app} /><span className="min-w-0 flex-1 truncate">{app.appName}</span><StatusDot app={app} /></button>)}</div>
          {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        </PopoverContent>
      </Popover>}
    </div>}
    {(error || query.error) && remaining.length === 0 && <p role="alert" className="max-w-40 truncate text-xs text-danger">{error || query.error?.message}</p>}
  </section>
}
