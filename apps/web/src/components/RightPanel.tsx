import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Monitor, Pencil, Plus, Users as UsersIcon } from 'lucide-react'
import type { Bot, PublicTurn, Task, TurnEvent, User } from '@openstaff/shared'
import type { RoomView } from '../lib/loaders'
import { RoomApps } from './RoomApps'
import { ComputerPanel } from './ComputerPanel'
import { useUsage } from './settings/Bots'
import { api } from '../lib/api'
import { BotAvatar, HumanAvatar } from './BotAvatar'
import { BotWorkstation } from './BotWorkstation'

interface Props {
  room: RoomView
  liveEvents: TurnEvent[]
  bots: Bot[]
  users: User[]
  turns: PublicTurn[]
  tasks: Task[]
  presence: Array<{ id: string; name: string }>
  onChanged: () => void
  me: User
  tab: 'members' | 'computer'
  onTab: (tab: 'members' | 'computer') => void
}

export function RightPanel({ room, bots, users, turns, tasks, presence, onChanged, liveEvents, me, tab, onTab }: Props) {
  const [adding, setAdding] = useState(false)
  const usage = useUsage()
  return <aside className="grid min-h-0 grid-rows-[64px_minmax(0,1fr)] border-l border-zinc-200 bg-[#fafafa]"><div className="flex items-end gap-1 border-b border-zinc-200 px-4"><button onClick={() => onTab('members')} className={`flex h-11 items-center gap-2 border-b-2 px-3 text-sm ${tab === 'members' ? 'border-black font-medium' : 'border-transparent text-zinc-500'}`}><UsersIcon size={15} />Members</button><button onClick={() => onTab('computer')} className={`flex h-11 items-center gap-2 border-b-2 px-3 text-sm ${tab === 'computer' ? 'border-black font-medium' : 'border-transparent text-zinc-500'}`}><Monitor size={15} />Computer</button></div><div className="scrollbar-thin min-h-0 overflow-y-auto p-4">{tab === 'members' ? <><div className="space-y-2">{room.members.map((member) => { const fallback = member.entity; if (!fallback) return null; const bot = member.memberKind === 'bot' ? bots.find((item) => item.id === member.memberId) ?? (fallback && 'job' in fallback ? fallback : undefined) : undefined; const entity = bot ?? fallback, online = member.memberKind === 'user' && presence.some((item) => item.id === member.memberId); return <div key={`${member.memberKind}-${member.memberId}`} title={bot ? `${(usage.data?.usage[bot.id]?.totalTokens ?? 0).toLocaleString()} tokens total` : undefined} className="flex items-center gap-3 rounded-xl bg-white p-3">{bot ? bot.status === 'working' || bot.status === 'waiting_approval' ? <BotWorkstation {...bot.avatar} size={34} state={bot.status === 'working' ? 'working' : 'waiting'} identity={`${bot.id}:${bot.status}`} label={bot.name} /> : <BotAvatar {...bot.avatar} size={34} label={bot.name} animate /> : <HumanAvatar name={entity.name} size={34} />}<div className="min-w-0 flex-1"><div className="truncate font-medium">{entity.name}</div><div className="flex items-center gap-1.5 text-xs capitalize text-zinc-500"><span className={`h-2 w-2 rounded-full ${bot ? bot.status === 'working' ? 'bg-blue-500' : bot.status === 'waiting_approval' ? 'bg-amber-500' : 'bg-emerald-500' : online ? 'bg-emerald-500' : 'bg-zinc-300'}`} />{bot ? bot.status.replace('_', ' ') : online ? 'present' : 'offline'}</div></div>{bot && <Link to="/bots/$botId" params={{ botId: bot.id }} aria-label={`Edit ${bot.name}`} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><Pencil size={14} /></Link>}</div> })}</div><RoomApps room={room} /><button onClick={() => setAdding((value) => !value)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 py-2.5 text-sm text-zinc-600"><Plus size={15} />Add member</button>{adding && <AddMember room={room} bots={bots} users={users} onAdded={() => { setAdding(false); onChanged() }} />}</> : <ComputerPanel turns={turns} tasks={tasks} bots={bots} liveEvents={liveEvents} me={me} />}</div></aside>
}

function AddMember({ room, bots, users, onAdded }: { room: RoomView; bots: Bot[]; users: User[]; onAdded: () => void }) {
  const memberIds = new Set(room.members.map((member) => member.memberId))
  const choices = [...bots.filter((bot) => !memberIds.has(bot.id)).map((bot) => ({ kind: 'bot', id: bot.id, name: bot.name })), ...users.filter((user) => !memberIds.has(user.id)).map((user) => ({ kind: 'user', id: user.id, name: user.name }))]
  const [value, setValue] = useState(choices[0] ? `${choices[0].kind}:${choices[0].id}` : '')
  const add = async () => { const [kind, id] = value.split(':'); if (!kind || !id) return; await api(`/api/rooms/${room.id}/members`, { method: 'POST', body: JSON.stringify({ kind, id }) }); onAdded() }
  return <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-3">{choices.length ? <><select value={value} onChange={(event) => setValue(event.target.value)} className="w-full rounded-lg border border-zinc-200 p-2">{choices.map((choice) => <option key={choice.id} value={`${choice.kind}:${choice.id}`}>{choice.name} ({choice.kind})</option>)}</select><button onClick={add} className="mt-2 w-full rounded-lg bg-black py-2 text-sm text-white">Add</button></> : <p className="text-sm text-zinc-500">Everyone is already here.</p>}</div>
}
