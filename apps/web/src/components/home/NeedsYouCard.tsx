import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { Bot, HomeNeedsYouItem } from '@openstaff/shared'
import type { RoomView } from '../../lib/loaders'
import { api } from '../../lib/api'
import { connectRoomApp } from '../../lib/connection-popup'
import { relativeTime } from '../../lib/time'
import { BotAvatar } from '../BotAvatar'

const primary = 'rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50'
const ghost = 'rounded-md border border-line-strong bg-transparent px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-3 disabled:opacity-50'

function matchingBot(item: HomeNeedsYouItem, bots: Bot[]): Bot | undefined {
  if (item.kind === 'approval') return bots.find((bot) => bot.id === item.botId)
  if (item.kind === 'connection') return bots.find((bot) => item.botIds.includes(bot.id))
  return bots.find((bot) => bot.name === item.botName)
}

export function NeedsYouCard({ item, bots, rooms }: { item: HomeNeedsYouItem; bots: Bot[]; rooms: RoomView[] }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bot = matchingBot(item, bots)
  const room = item.kind === 'connection'
    ? rooms.find((candidate) => item.botIds.some((botId) => candidate.members.some((member) => member.memberKind === 'bot' && member.memberId === botId)))
    : rooms.find((candidate) => candidate.id === item.roomId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['home-feed'] })
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await operation() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Action failed') }
    finally { setBusy(false) }
  }
  const decide = (decision: 'approve' | 'deny' | 'human_completed') => run(async () => {
    if (item.kind !== 'approval') return
    await api(`/api/approvals/${item.id}`, { method: 'POST', body: JSON.stringify({ decision }) })
    await refresh()
  })
  const takeOver = () => run(async () => {
    if (item.kind !== 'approval') return
    await api('/api/computer/lease/take', { method: 'POST', body: '{}' })
    await navigate({ to: '/rooms/$roomId', params: { roomId: item.roomId }, search: { computer: 1 } })
  })
  const reconnect = () => run(async () => {
    if (item.kind !== 'connection') return
    if (!room) { await navigate({ to: '/marketplace' }); return }
    await connectRoomApp(room.id, item.slug)
    await refresh()
  })
  const runAgain = () => run(async () => {
    if (item.kind !== 'automation_failed') return
    await api(`/api/automations/${item.automationId}/run`, { method: 'POST', body: '{}' })
    await refresh()
  })

  const title = item.kind === 'approval' ? `${item.botName} needs approval`
    : item.kind === 'connection' ? `Reconnect ${item.appName}${bot ? ` for ${bot.name}` : ''}`
      : `${item.automationName} failed`
  const detail = item.kind === 'approval' ? `${item.roomName} · ${item.summary} · ${relativeTime(item.createdAt)}`
    : item.kind === 'connection' ? `${bot?.name ?? 'Team'} · connection expired`
      : `${item.botName} · ${item.error}${item.nextRunAt ? ` · next run ${relativeTime(item.nextRunAt)}` : ''}`

  return <article className="rounded-xl border border-waiting/60 bg-surface-2 px-4 py-3 shadow-card">
    <div className="flex flex-wrap items-center gap-3">
      {bot ? <BotAvatar {...bot.avatar} size={28} label={bot.name} /> : <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-waiting/15 text-xs text-waiting">!</span>}
      <div className="min-w-[220px] flex-1"><h3 className="text-[13px] font-semibold text-fg">{title}</h3><p className="mt-0.5 truncate text-xs text-fg-subtle">{detail}</p></div>
      <div className="ml-auto flex flex-wrap justify-end gap-2">
        {item.kind === 'approval' && <><button type="button" disabled={busy} onClick={() => void decide('approve')} className={primary}>Approve</button><button type="button" disabled={busy} onClick={() => void decide('deny')} className={ghost}>Not now</button>{item.browser && <><button type="button" disabled={busy} onClick={() => void takeOver()} className={ghost}>Take over</button><button type="button" disabled={busy} onClick={() => void decide('human_completed')} className={ghost}>Done by me</button></>}</>}
        {item.kind === 'connection' && <button type="button" disabled={busy} onClick={() => void reconnect()} className={primary}>Reconnect</button>}
        {item.kind === 'automation_failed' && <><button type="button" disabled={busy} onClick={() => void runAgain()} className={primary}>Run again</button><Link to="/rooms/$roomId" params={{ roomId: item.roomId }} className={ghost}>Open</Link></>}
      </div>
    </div>
    {error && <p role="alert" className="mt-2 pl-10 text-xs text-danger">{error}</p>}
  </article>
}
