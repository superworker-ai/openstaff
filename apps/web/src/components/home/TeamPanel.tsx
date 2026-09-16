import { Link } from '@tanstack/react-router'
import type { Bot, HomeNeedsYouItem } from '@openstaff/shared'
import type { RoomView } from '../../lib/loaders'
import { BotAvatar } from '../BotAvatar'

function itemNeedsBot(item: HomeNeedsYouItem, bot: Bot): boolean {
  if (item.kind === 'connection') return item.botIds.includes(bot.id)
  if (item.kind === 'automation_failed') return item.botName === bot.name
  return item.botId === bot.id
}

export function TeamPanel({ bots, rooms, needsYou }: { bots: Bot[]; rooms: RoomView[]; needsYou: HomeNeedsYouItem[] }) {
  return <aside aria-label="Team" className="rounded-xl border border-line bg-surface-2 p-2.5">
    <h2 className="px-1 pb-2 pt-0.5 text-[11px] font-semibold uppercase tracking-[.06em] text-fg-subtle">Team</h2>
    <div className="space-y-0.5">{bots.map((bot) => {
      const dm = rooms.find((room) => room.kind === 'dm' && room.members.some((member) => member.memberKind === 'bot' && member.memberId === bot.id))
      const waiting = bot.status === 'waiting_approval' || needsYou.some((item) => itemNeedsBot(item, bot))
      const working = !waiting && bot.status === 'working'
      const status = waiting ? 'needs you' : working ? 'working' : 'idle'
      const content = <><BotAvatar {...bot.avatar} size={22} label={bot.name} /><span className="min-w-0 truncate text-[13px] text-fg">{bot.name}</span><span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-fg-subtle"><i aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${waiting ? 'bg-waiting motion-safe:animate-pulse' : working ? 'bg-working' : 'bg-fg-subtle'}`} />{status}</span></>
      return dm
        ? <Link key={bot.id} aria-label={`${bot.name}, ${status}`} to="/rooms/$roomId" params={{ roomId: dm.id }} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-3">{content}</Link>
        : <div key={bot.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">{content}</div>
    })}</div>
    <Link to="/bots/new" className="mt-1.5 block border-t border-line px-1 pb-0.5 pt-2 text-xs text-fg-muted underline-offset-4 hover:text-fg hover:underline">+ Hire someone new</Link>
  </aside>
}
