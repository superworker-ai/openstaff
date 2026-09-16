import { Clock3 } from 'lucide-react'
import type { HomeUpcomingItem } from '@openstaff/shared'
import { relativeTime } from '../../lib/time'

export function UpcomingRow({ item }: { item: HomeUpcomingItem }) {
  return <article className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-2 py-3">
    <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-lg bg-surface-3 text-fg-muted"><Clock3 size={15} /></span>
    <h3 className="truncate text-[13px] text-fg">{item.name}<span className="text-fg-muted"> · {item.botNames.join(', ') || 'Team'}</span></h3>
    <time className="text-xs text-fg-muted">{relativeTime(item.nextRunAt)}</time>
  </article>
}
