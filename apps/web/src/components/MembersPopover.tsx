import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Pencil, Plus } from 'lucide-react'
import type { Bot, User } from '@openstaff/shared'
import type { RoomView } from '../lib/loaders'
import { api } from '../lib/api'
import { useUsage } from './settings/Bots'
import { BotAvatar, HumanAvatar } from './BotAvatar'
import { BotWorkstation } from './BotWorkstation'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

interface Props {
  room: RoomView
  bots: Bot[]
  users: User[]
  presence: Array<{ id: string; name: string }>
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  onRoomSettings: () => void
  trigger: ReactNode
}

export function MembersPopover({ room, bots, users, presence, open, onOpenChange, onChanged, onRoomSettings, trigger }: Props) {
  const [adding, setAdding] = useState(false)
  const usage = useUsage()
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverAnchor asChild>{trigger}</PopoverAnchor>
    <PopoverContent label="Members" align="start" className="max-h-[calc(100dvh-1rem)] w-[min(360px,calc(100vw-1rem))] overflow-y-auto p-3">
      <h2 className="mb-3 px-1 text-sm font-semibold">Members</h2>
      <div className="space-y-1.5">
        {room.members.map((member) => {
          const fallback = member.entity
          if (!fallback) return null
          const bot = member.memberKind === 'bot' ? bots.find((item) => item.id === member.memberId) ?? (fallback && 'job' in fallback ? fallback : undefined) : undefined
          const entity = bot ?? fallback
          const online = member.memberKind === 'user' && presence.some((item) => item.id === member.memberId)
          const status = bot ? bot.status === 'working' ? 'working' : bot.status === 'waiting_approval' ? 'waiting approval' : 'idle' : online ? 'present' : 'offline'
          return <div key={`${member.memberKind}-${member.memberId}`} title={bot ? `${(usage.data?.usage[bot.id]?.totalTokens ?? 0).toLocaleString()} tokens total` : undefined} className="flex items-center gap-3 rounded-md bg-surface-3 p-2.5">
            {bot ? bot.status === 'working' || bot.status === 'waiting_approval' ? <BotWorkstation {...bot.avatar} size={34} state={bot.status === 'working' ? 'working' : 'waiting'} identity={`${bot.id}:${bot.status}`} label={bot.name} /> : <BotAvatar {...bot.avatar} size={34} label={bot.name} animate /> : <HumanAvatar name={entity.name} size={34} />}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-fg">{entity.name}</div>
              <div className="flex items-center gap-1.5 text-xs text-fg-muted"><span className={`h-2 w-2 rounded-full ${bot ? bot.status === 'working' ? 'bg-working' : bot.status === 'waiting_approval' ? 'bg-waiting motion-safe:animate-pulse' : 'bg-ok' : online ? 'bg-ok' : 'bg-fg-subtle'}`} />{status}</div>
            </div>
            {bot && <Link to="/bots/$botId" params={{ botId: bot.id }} aria-label={`Edit ${bot.name}`} className="rounded-md p-1.5 text-fg-subtle hover:bg-surface-4 hover:text-fg"><Pencil size={14} /></Link>}
          </div>
        })}
      </div>
      <button type="button" onClick={() => setAdding((value) => !value)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-line-strong py-2.5 text-sm text-fg-muted hover:bg-surface-3 hover:text-fg"><Plus size={15} />Add member</button>
      {adding && <AddMember room={room} bots={bots} users={users} onAdded={() => { setAdding(false); onChanged() }} />}
      <a href={`/rooms/${room.id}`} onClick={(event) => { event.preventDefault(); onOpenChange(false); onRoomSettings() }} className="mt-3 block w-full rounded-md px-3 py-2 text-left text-sm text-fg-muted hover:bg-surface-3 hover:text-fg">Room settings</a>
    </PopoverContent>
  </Popover>
}

export function AddMember({ room, bots, users, onAdded }: { room: RoomView; bots: Bot[]; users: User[]; onAdded: () => void }) {
  const memberIds = new Set(room.members.map((member) => member.memberId))
  const choices = [
    ...bots.filter((bot) => !memberIds.has(bot.id)).map((bot) => ({ kind: 'bot', id: bot.id, name: bot.name })),
    ...users.filter((user) => !memberIds.has(user.id)).map((user) => ({ kind: 'user', id: user.id, name: user.name })),
  ]
  const [value, setValue] = useState(choices[0] ? `${choices[0].kind}:${choices[0].id}` : '')
  const add = async () => {
    const [kind, id] = value.split(':')
    if (!kind || !id) return
    await api(`/api/rooms/${room.id}/members`, { method: 'POST', body: JSON.stringify({ kind, id }) })
    onAdded()
  }
  return <div className="mt-2 rounded-md border border-line bg-surface-3 p-3">{choices.length ? <>
    <select value={value} onChange={(event) => setValue(event.target.value)} className="w-full rounded-md border border-line-strong bg-surface-2 p-2 text-fg">
      {choices.map((choice) => <option key={choice.id} value={`${choice.kind}:${choice.id}`}>{choice.name} ({choice.kind})</option>)}
    </select>
    <button type="button" onClick={() => void add()} className="mt-2 w-full rounded-md bg-accent py-2 text-sm font-medium text-accent-fg">Add</button>
  </> : <p className="text-sm text-fg-muted">Everyone is already here.</p>}</div>
}
