import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Bot, ComputerStatus, PublicTurn, Task, TurnEvent, User } from '@openstaff/shared'
import { api } from '../lib/api'
import { BotAvatar } from './BotAvatar'
import { DesktopStream } from './DesktopStream'
import { computerActivityLine } from '../lib/computer-activity'

export function ComputerPanel({ turns, tasks, bots, liveEvents, me }: { turns: PublicTurn[]; tasks: Task[]; bots: Bot[]; liveEvents: TurnEvent[]; me: User }) {
  const sorted = [...turns].sort((a, b) => (b.startedAt ?? b.id).localeCompare(a.startedAt ?? a.id))
  const latest = sorted.find((turn) => ['running', 'waiting_approval'].includes(turn.status)) ?? sorted[0]
  const status = useQuery({ queryKey: ['computer-status'], queryFn: () => api<ComputerStatus>('/api/computer/status'), refetchInterval: 5000 })
  const [dismissedNotice, setDismissedNotice] = useState<string>()
  const activity = useQuery({ queryKey: ['turn-events', latest?.id], queryFn: () => api<{ events: TurnEvent[] }>(`/api/turns/${latest!.id}/events`), enabled: Boolean(latest), refetchInterval: latest?.status === 'running' ? 3000 : false })
  const events = [...new Map([...(activity.data?.events ?? []), ...liveEvents.filter((event) => event.turnId === latest?.id)].map((event) => [event.id, event])).values()].sort((a, b) => a.seq - b.seq)
  const screenshot = [...events].reverse().find((event) => event.type === 'screenshot')
  const calls = events.filter((event) => event.type === 'tool-call' || event.type === 'status')
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }, [calls.length])
  const leaseOwner = status.data?.lease?.ownerKind === 'human' ? status.data.lease.ownerName ?? 'Human' : 'Bot'
  return <>{status.data?.detail?.startsWith('Recreated ') && dismissedNotice !== status.data.detail && <div className="mb-3 flex items-start justify-between gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900" role="status"><span>{status.data.detail}</span><button type="button" aria-label="Dismiss recreation notice" onClick={() => setDismissedNotice(status.data?.detail)}>×</button></div>}<p className="mb-3 text-xs text-zinc-500" title={status.data?.error}>Computer: {status.data?.provider ?? ''} · {status.data?.status ?? 'starting'} · {leaseOwner} in control</p>
    {status.data?.desktop?.stream && status.data.lease ? <DesktopStream lease={status.data.lease} me={me} kind={status.data.desktop.kind} /> : <div className="mb-4"><p className="mb-2 text-xs font-medium text-zinc-500">{status.data?.desktop ? "Desktop offline · showing last screenshot" : "Latest screenshot"}</p>{typeof screenshot?.payload.url === 'string' ? <a href={screenshot.payload.url} target="_blank" rel="noreferrer"><img src={screenshot.payload.url} alt={String(screenshot.payload.title ?? (screenshot.payload.source === 'desktop' ? 'Desktop screenshot' : 'Browser screenshot'))} className="w-full rounded-xl border border-zinc-200" /></a> : <div className="grid h-36 place-items-center rounded-xl border border-zinc-200 bg-white text-xs text-zinc-400">No screen captured yet</div>}</div>}
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Activity</h3><div ref={scroll} className="max-h-64 space-y-2 overflow-auto">{calls.map((event) => { const computerLine = computerActivityLine(event); return <div key={event.id} className="rounded-xl border border-zinc-200 bg-white p-3">{computerLine ? <div className="text-xs font-medium">{computerLine}</div> : <><div className="text-xs font-medium">{String(event.payload.toolName ?? event.payload.status ?? event.type)}</div><p className="mt-1 truncate text-[11px] text-zinc-500" title={JSON.stringify(event.payload.input)}>{JSON.stringify(event.payload.input ?? {}).slice(0, 180)}</p></>}</div> })}{!calls.length && <p className="text-sm text-zinc-400">No activity recorded.</p>}</div>
    <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-zinc-400">Open tasks</h3>{tasks.filter((task) => !['done', 'cancelled'].includes(task.status)).map((task) => { const owner = bots.find((bot) => bot.id === task.ownerBotId); return <div key={task.id} className="mb-2 flex gap-2 rounded-xl bg-white p-3">{owner && <BotAvatar {...owner.avatar} size={26} />}<div><p className="text-sm font-medium">{task.title}</p><p className="mt-1 text-xs text-zinc-500">{owner?.name} · {task.status.replaceAll('_', ' ')}</p></div></div> })}</>
}
