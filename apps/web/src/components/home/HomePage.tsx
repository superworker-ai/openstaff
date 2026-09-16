import { Fragment } from 'react'
import { Link } from '@tanstack/react-router'
import type { HomeDigest, HomeFeed, User } from '@openstaff/shared'
import type { RoomView } from '../../lib/loaders'
import { FirstRunChecklist } from '../FirstRunChecklist'
import { DoneRow } from './DoneRow'
import { FeedSection } from './FeedSection'
import { NeedsYouCard } from './NeedsYouCard'
import { NowCard } from './NowCard'
import { TeamPanel } from './TeamPanel'
import { UpcomingRow } from './UpcomingRow'

function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Morning'
  if (hour >= 12 && hour < 18) return 'Afternoon'
  return 'Evening'
}

function DigestText({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith('**') && part.endsWith('**')
    ? <b key={index}>{part.slice(2, -2)}</b>
    : <Fragment key={index}>{part}</Fragment>)}</>
}

function Empty({ children }: { children: string }) {
  return <p className="py-2 text-[13px] text-fg-subtle">{children}</p>
}

export function HomePage({ feed, digest, digestLoading, currentUser, rooms }: { feed: HomeFeed; digest?: HomeDigest; digestLoading: boolean; currentUser: User; rooms: RoomView[] }) {
  const now = new Date()
  const firstName = currentUser.name.trim().split(/\s+/)[0] || currentUser.name
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(now)
  const working = feed.bots.filter((bot) => bot.status === 'working').length
  return <main aria-label="Home" className="h-full min-h-0 overflow-y-auto bg-surface">
    <div className="mx-auto max-w-[920px] px-6 py-7">
      <div className="mb-1 grid grid-cols-[minmax(0,1fr)_220px] items-start gap-7 max-md:grid-cols-1">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-.015em] text-fg">{greeting(now.getHours())}, {firstName}</h1>
          <p className="mt-0.5 text-[13px] text-fg-muted">{date} · {working} working · {feed.needsYou.length} needs you</p>
          <div className="mt-4 min-h-[48px] text-[15px] leading-[1.6] text-fg">
            {digestLoading && !digest ? <div aria-label="Loading digest" className="space-y-2 pt-1"><div className="h-3.5 w-full animate-pulse rounded bg-surface-3" /><div className="h-3.5 w-4/5 animate-pulse rounded bg-surface-3" /></div> : digest && <p><DigestText text={digest.text} />{digest.source === 'template' && !feed.onboarding.model && <> <Link to="/settings" className="text-xs text-fg-muted underline decoration-line-strong underline-offset-4 hover:text-fg">Add a model key for a smarter digest</Link></>}</p>}
          </div>
        </div>
        <TeamPanel bots={feed.bots} rooms={rooms} needsYou={feed.needsYou} />
      </div>

      {!feed.onboarding.complete && <div className="mt-6"><FirstRunChecklist initialData={feed.onboarding} /></div>}

      <FeedSection title="Needs you" count={feed.needsYou.length}>
        {feed.needsYou.length ? <div className="space-y-2.5">{feed.needsYou.map((item) => <NeedsYouCard key={`${item.kind}:${item.id}`} item={item} bots={feed.bots} rooms={rooms} />)}</div> : <Empty>Nothing needs you.</Empty>}
      </FeedSection>
      <FeedSection title="Happening now" count={feed.now.length}>
        {feed.now.length ? <div className="space-y-3">{feed.now.map((item) => <NowCard key={item.turnId} item={item} bot={feed.bots.find((bot) => bot.id === item.botId)} />)}</div> : <Empty>Nobody is working right now.</Empty>}
      </FeedSection>
      <FeedSection title="Done today" count={feed.done.length}>
        {feed.done.length ? <div className="divide-y divide-line">{feed.done.map((item) => <DoneRow key={item.turnId} item={item} />)}</div> : <Empty>No finished work in the last day.</Empty>}
      </FeedSection>
      <FeedSection title="Coming up" count={feed.upcoming.length} action={<Link to="/settings" search={{ section: 'automations' }}>All automations →</Link>}>
        {feed.upcoming.length ? <div className="divide-y divide-line">{feed.upcoming.map((item) => <UpcomingRow key={item.automationId} item={item} />)}</div> : <Empty>No automations scheduled.</Empty>}
      </FeedSection>
    </div>
  </main>
}
