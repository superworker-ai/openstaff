import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { Bot, HomeNowItem } from '@openstaff/shared'
import { BotAvatar } from '../BotAvatar'

function elapsed(startedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function NowCard({ item, bot }: { item: HomeNowItem; bot?: Bot }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const action = 'rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-3'
  return <article className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-4 rounded-xl border border-line bg-surface-2 p-4 shadow-card max-sm:grid-cols-1">
    <div className="relative h-[92px] w-[150px] overflow-hidden rounded-lg border border-line-strong bg-screen">
      {item.screenshotUrl ? <img src={item.screenshotUrl} alt={`Latest view from ${item.botName}`} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-[radial-gradient(circle_at_65%_30%,color-mix(in_oklab,var(--color-working)_22%,transparent),transparent_60%)]" />}
      <span className="absolute left-2 top-2 rounded bg-danger px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">LIVE</span>
    </div>
    <div className="min-w-0">
      <div className="flex items-center gap-2">{bot && <BotAvatar {...bot.avatar} size={22} label={bot.name} />}<h3 className="truncate text-[13px] font-semibold text-fg">{item.botName}{item.roomName !== item.botName && <> · {item.roomName}</>}</h3><time className="ml-auto shrink-0 text-xs tabular-nums text-fg-subtle">{elapsed(item.startedAt, now)}</time></div>
      <p className="mt-1 truncate text-[13px] text-fg-muted">{item.lastAction ?? 'Working…'}</p>
      <div className="mt-2 flex gap-2"><Link to="/rooms/$roomId" params={{ roomId: item.roomId }} search={{ computer: 1 }} className={action}>Watch</Link><Link to="/rooms/$roomId" params={{ roomId: item.roomId }} className={action}>Open room</Link></div>
    </div>
  </article>
}
