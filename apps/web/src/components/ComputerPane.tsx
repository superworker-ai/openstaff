import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FileText, Folder, Globe2, ListTree, LoaderCircle, Maximize2, Monitor, RefreshCw, Terminal, X } from 'lucide-react'
import type { Bot, ComputerLease, ComputerStatus, PublicTurn, Task, TurnEvent, User } from '@openstaff/shared'
import type { RoomView } from '../lib/loaders'
import { api } from '../lib/api'
import { useTheme, type ResolvedTheme } from '../lib/theme'
import { ActivityBar } from './ActivityBar'
import { BotAvatar } from './BotAvatar'
import { BrandMark } from './BrandMark'
import { DesktopStream, type DesktopStreamHandle } from './DesktopStream'
import { IconButton } from './ui/icon-button'

interface Props {
  room: RoomView
  bots: Bot[]
  turns: PublicTurn[]
  tasks: Task[]
  liveEvents: TurnEvent[]
  me: User
  onClose: () => void
}

function remaining(expiresAt: string | null, now: number): string {
  const seconds = Math.max(0, Math.ceil(((expiresAt ? Date.parse(expiresAt) : now) - now) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function leaseLabel(lease: ComputerLease, me: User, now: number) {
  if (lease.ownerKind === 'bot') return 'Live · Bot in control'
  if (lease.ownerId === me.id) return `You have control · returns in ${remaining(lease.expiresAt, now)}`
  return `${lease.ownerName ?? 'Another member'} has control`
}

function localClock(now: number) {
  const date = new Date(now)
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date).replaceAll(',', '')
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  return `${day}  ${time}`
}

function wallpaper(hour: number, theme: ResolvedTheme): CSSProperties {
  const colors = theme === 'light'
    ? hour >= 5 && hour < 9
      ? ['#9cc4f2', '#d9e6f7', '#f9dcc8']
      : hour >= 9 && hour < 17
        ? ['#4d9ef0', '#a9d3fb', '#f1f8ff']
        : hour >= 17 && hour < 21
          ? ['#6f9fe0', '#c9d8f0', '#f6c9a3']
          : ['#2d5a9e', '#7fa6dc', '#d9e5f5']
    : hour >= 5 && hour < 9
      ? ['#f2a07b', '#ad6f8e', '#31345d', '#08090f']
      : hour >= 9 && hour < 17
        ? ['#55a9cf', '#287f88', '#193b63', '#08090f']
        : hour >= 17 && hour < 21
          ? ['#f49a55', '#7d4f91', '#252b5f', '#08090f']
          : ['#26336d', '#171c45', '#090b24', '#08090f']
  return {
    '--wp-1': colors[0],
    '--wp-2': colors[1],
    '--wp-3': colors[2],
    '--wp-4': colors[3] ?? colors[2],
    background: theme === 'light'
      ? 'radial-gradient(60% 45% at 25% 30%, rgb(255 255 255 / .75), transparent 70%), radial-gradient(45% 35% at 72% 52%, rgb(255 255 255 / .6), transparent 70%), radial-gradient(70% 30% at 55% 78%, rgb(255 255 255 / .5), transparent 70%), linear-gradient(180deg, var(--wp-1) 0%, var(--wp-2) 55%, var(--wp-3) 100%)'
      : 'radial-gradient(circle at 72% 26%, var(--wp-1), transparent 38%), radial-gradient(circle at 20% 72%, var(--wp-2), transparent 45%), linear-gradient(145deg, var(--wp-3), var(--wp-4))',
  } as CSSProperties
}

export function ComputerPane({ room, bots, turns, tasks, liveEvents, me, onClose }: Props) {
  const { resolved } = useTheme()
  const sorted = useMemo(() => [...turns].sort((a, b) => (b.startedAt ?? b.id).localeCompare(a.startedAt ?? a.id)), [turns])
  const latest = sorted.find((turn) => ['running', 'waiting_approval'].includes(turn.status)) ?? sorted[0]
  const status = useQuery({ queryKey: ['computer-status'], queryFn: () => api<ComputerStatus>('/api/computer/status'), refetchInterval: 5000 })
  const activity = useQuery({ queryKey: ['turn-events', latest?.id], queryFn: () => api<{ events: TurnEvent[] }>(`/api/turns/${latest!.id}/events`), enabled: Boolean(latest), refetchInterval: latest?.status === 'running' ? 3000 : false })
  const events = useMemo(() => [...new Map([...(activity.data?.events ?? []), ...liveEvents.filter((event) => event.turnId === latest?.id)].map((event) => [event.id, event])).values()].sort((a, b) => a.seq - b.seq), [activity.data?.events, latest?.id, liveEvents])
  const screenshot = [...events].reverse().find((event) => event.type === 'screenshot')
  const bot = room.kind === 'dm' ? room.members.map((member) => member.memberKind === 'bot' ? bots.find((item) => item.id === member.memberId) ?? member.entity : undefined).find((entity): entity is Bot => Boolean(entity && 'job' in entity)) : undefined
  const [dismissedNotice, setDismissedNotice] = useState<string>()
  const [activityOpen, setActivityOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState('')
  const [now, setNow] = useState<number | null>(null)
  const monitor = useRef<HTMLDivElement>(null)
  const stream = useRef<DesktopStreamHandle>(null)
  const data = status.data
  const live = Boolean(data?.desktop?.stream && data.lease)
  const mine = data?.lease?.ownerKind === 'human' && data.lease.ownerId === me.id

  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const timer = setInterval(tick, mine ? 1000 : 30_000)
    return () => clearInterval(timer)
  }, [mine, data?.lease?.expiresAt])

  const reconnect = async () => {
    if (stream.current) await stream.current.reconnect()
    else await status.refetch()
  }
  const restart = async () => {
    setRestarting(true); setRestartError('')
    try { await api('/api/computer/restart', { method: 'POST', body: '{}' }); await status.refetch() }
    catch (reason) { setRestartError(reason instanceof Error ? reason.message : 'Could not start computer') }
    finally { setRestarting(false) }
  }
  const unavailable = data?.capabilities?.desktop === false || (data?.status === 'ready' && !data.desktop)
  const title = bot ? `${bot.name}'s computer` : 'Computer'
  const stateLabel = live && data?.lease ? leaseLabel(data.lease, me, now ?? 0) : data?.status === 'starting' || !data ? 'starting…' : data.status
  const screenshotUrl = typeof screenshot?.payload.url === 'string' ? screenshot.payload.url : undefined
  const openTasks = tasks.filter((task) => !['done', 'cancelled'].includes(task.status)).map((task) => {
    const owner = bots.find((item) => item.id === task.ownerBotId)
    return <div key={task.id} className="activity-task">{owner ? <BotAvatar {...owner.avatar} size={26} label={owner.name} /> : <FileText size={20} className="text-fg-muted" />}<div><p>{task.title}</p><p>{[owner?.name, task.status.replaceAll('_', ' ')].filter(Boolean).join(' · ')}</p></div></div>
  })

  return <aside className="h-full min-h-0 bg-surface p-3 pl-0" aria-label={title}>
    <div ref={monitor} className="h-full min-h-0 overflow-hidden rounded-2xl border border-line-strong bg-screen">
      <div className="computer-monitor-content flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-glass-line bg-glass-strong px-2.5 text-xs text-fg backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          {bot ? <BotAvatar {...bot.avatar} size={16} label={bot.name} animate /> : <BrandMark size={16} />}
          <span className="truncate font-medium">{title}</span>
          <span className="truncate rounded-full border border-glass-line bg-glass-tile px-2 py-0.5 text-[11px] text-fg-muted">{stateLabel}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <time className="mr-1 whitespace-nowrap text-[11px] text-fg-muted">{now === null ? '' : localClock(now)}</time>
          <IconButton label="Toggle activity" aria-pressed={activityOpen} onClick={() => setActivityOpen((value) => !value)} className="h-7 w-7"><ListTree size={14} /></IconButton>
          <IconButton label="Reconnect desktop" disabled={restarting} onClick={() => void reconnect()} className="h-7 w-7"><RefreshCw size={14} /></IconButton>
          <IconButton label="Open desktop fullscreen" onClick={() => monitor.current?.requestFullscreen()} className="h-7 w-7"><Maximize2 size={14} /></IconButton>
          <IconButton label="Close computer" onClick={onClose} className="h-7 w-7"><X size={14} /></IconButton>
        </div>
      </div>
      {data?.detail?.startsWith('Recreated ') && dismissedNotice !== data.detail && <div className="flex shrink-0 items-center justify-between gap-2 border-b border-waiting/20 bg-waiting/10 px-3 py-1.5 text-xs text-fg" role="status"><span className="truncate">{data.detail}</span><button type="button" aria-label="Dismiss recreation notice" onClick={() => setDismissedNotice(data.detail)} className="text-fg-muted hover:text-fg">×</button></div>}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {live && data?.lease && data.desktop
          ? <DesktopStream ref={stream} lease={data.lease} me={me} kind={data.desktop.kind} renderOverlay={(leaseControls) => <ActivityBar events={events} turn={latest} open={activityOpen} onOpenChange={setActivityOpen} leaseControls={leaseControls} openTasks={openTasks.length ? openTasks : undefined} />} />
          : <><div className="absolute inset-0 overflow-y-auto">
            <div aria-hidden="true" className="absolute -inset-6 motion-safe:animate-[wallpaper-drift_60s_ease-in-out_infinite]" style={wallpaper(new Date(now ?? 0).getHours(), resolved)} />
            {screenshotUrl && <><img src={screenshotUrl} alt={String(screenshot?.payload.title ?? (screenshot?.payload.source === 'desktop' ? 'Desktop screenshot' : 'Browser screenshot'))} className="absolute inset-0 h-full w-full object-cover opacity-60" /><span className="absolute left-3 top-3 rounded-full border border-glass-line bg-glass-strong px-2 py-1 text-[11px] text-fg-muted backdrop-blur">Last screenshot</span></>}
            <div className="relative z-10 flex min-h-full items-center justify-center px-5 py-20">
              <div className="w-full max-w-[440px] rounded-2xl border border-glass-line bg-glass p-7 text-center shadow-glass backdrop-blur-xl">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-glass-tile text-fg"><Monitor size={27} /></span>
                <h2 className="mt-5 text-xl font-semibold text-fg">{bot ? `${bot.name} works here` : 'Your team works here'}</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-fg-muted">{bot ? `Ask ${bot.name} for anything that needs a browser, files, or a terminal and it happens on this screen, live. Step in and take the wheel whenever you like.` : 'Anything a bot in this room does with a browser, files, or a terminal shows up on this screen, live. Step in and take the wheel whenever you like.'}</p>
                <div className="mt-6 min-h-9 text-sm">
                  {unavailable ? <p className="text-fg-muted">Live view isn't available on the {data?.provider} provider. <Link to="/settings" search={{ section: 'computer' }} className="text-fg underline underline-offset-2">Computer settings</Link></p>
                    : data?.status === 'error' ? <p className="text-danger">{data.detail || data.error || 'The computer could not start.'} <Link to="/settings" search={{ section: 'computer' }} className="text-fg underline underline-offset-2">Computer settings</Link></p>
                      : data?.status === 'stopped' || data?.status === 'paused' ? me.role === 'owner'
                        ? <button type="button" disabled={restarting} onClick={() => void restart()} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg">{restarting ? 'Starting up…' : 'Start computer'}</button>
                        : <p className="text-fg-muted">Ask a workspace owner to start it</p>
                        : <p className="inline-flex items-center gap-2 text-fg-muted"><LoaderCircle size={15} className="animate-spin" />Starting up…</p>}
                  {restartError && <p role="alert" className="mt-2 text-xs text-danger">{restartError}</p>}
                </div>
              </div>
            </div>
            <div aria-hidden="true" className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-glass-line bg-glass-strong p-1.5 shadow-glass backdrop-blur-xl">
              <span className="grid h-9 w-9 place-items-center rounded-lg text-fg-muted"><Globe2 size={18} /></span>
              <span className="grid h-9 w-9 place-items-center rounded-lg text-fg-muted"><Folder size={18} /></span>
              <span className="grid h-9 w-9 place-items-center rounded-lg text-fg-muted"><Terminal size={18} /></span>
            </div>
          </div><ActivityBar events={events} turn={latest} open={activityOpen} onOpenChange={setActivityOpen} leaseControls={null} openTasks={openTasks.length ? openTasks : undefined} /></>}
      </div>
      </div>
    </div>
  </aside>
}
