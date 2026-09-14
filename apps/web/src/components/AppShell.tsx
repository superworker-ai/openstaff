import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bot, LogOut, Plus, Search, ShoppingBag, Users } from 'lucide-react'
import type { Bot as BotType, User } from '@openstaff/shared'
import type { RoomView } from '../lib/loaders'
import { api, formatTime } from '../lib/api'
import { sortRooms } from '../lib/room-order'
import { BotAvatar, HumanAvatar } from './BotAvatar'
import { BotWorkstation } from './BotWorkstation'

interface Props {
  rooms: RoomView[]
  currentRoomId?: string
  currentUser: User
  bots: BotType[]
  users: User[]
  children: React.ReactNode
}

function roomBots(room: RoomView, bots?: BotType[]): BotType[] {
  return room.members.filter((member) => member.memberKind === 'bot').map((member) => bots?.find((bot) => bot.id === member.memberId) ?? member.entity).filter((entity): entity is BotType => Boolean(entity && 'job' in entity))
}

function RoomAvatar({ room, bots }: { room: RoomView; bots: BotType[] }) {
  const members = roomBots(room, bots), bot = members[0]
  if (room.kind === 'dm' && bot) return bot.status === 'working' || bot.status === 'waiting_approval' ? <BotWorkstation {...bot.avatar} size={38} state={bot.status === 'working' ? 'working' : 'waiting'} identity={`${bot.id}:${bot.status}`} label={bot.name} /> : <BotAvatar {...bot.avatar} size={38} label={bot.name} animate />
  return <div className="relative h-10 shrink-0" style={{ width: 38 + (Math.min(members.length, 3) - 1) * 10 }}>{members.slice(0, 3).map((member, index) => <div key={member.id} className="absolute rounded-full border-2 border-[#f6f6f5]" style={{ left: index * 10, zIndex: 3 - index }}><BotAvatar {...member.avatar} size={34} label={member.name} animate /></div>)}</div>
}

export function AppShell({ rooms, currentRoomId, currentUser, bots, users, children }: Props) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const filtered = rooms.filter((room) => (room.name ?? roomBots(room, bots)[0]?.name ?? '').toLowerCase().includes(search.toLowerCase()))
  const sections = useMemo(() => {
    const groups = new Map<string, RoomView[]>()
    for (const room of sortRooms(filtered)) {
      const key = room.section || 'Unassigned'
      groups.set(key, [...(groups.get(key) ?? []), room])
    }
    return [...groups.entries()]
  }, [filtered])

  return <main className="grid h-screen grid-cols-[280px_minmax(0,1fr)] overflow-hidden bg-white">
    <aside className="flex min-h-0 flex-col border-r border-zinc-200 bg-[#f6f6f5] p-3">
      <div className="mb-3 flex items-center justify-between px-1 py-2"><div className="flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-xl bg-black text-white">O</span>OpenStaff</div><div className="relative"><button onClick={() => setMenu((value) => !value)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-zinc-200" aria-label="Create"><Plus size={18} /></button>{menu && <div className="absolute right-0 top-10 z-20 w-40 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg"><Link to="/bots/new" className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-zinc-100"><Bot size={15} />New bot</Link><button onClick={() => { setGroupOpen(true); setMenu(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-zinc-100"><Users size={15} />New group</button></div>}</div></div>
      <label className="mb-4 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-zinc-500"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="w-full bg-transparent outline-none" /></label>
      <nav className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{sections.map(([section, values]) => <section key={section} className="mb-5"><h2 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{section}</h2>{values.map((room) => { const name = room.name ?? roomBots(room, bots)[0]?.name ?? 'Room'; return <Link key={room.id} to="/rooms/$roomId" params={{ roomId: room.id }} className={`mb-1 grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-xl p-2 ${currentRoomId === room.id ? 'bg-white' : 'hover:bg-white/70'}`}><RoomAvatar room={room} bots={bots} /><div className="min-w-0"><div className="flex justify-between gap-2"><span className="truncate font-medium">{name}</span><time className="text-[11px] text-zinc-400">{formatTime(room.lastMessageAt)}</time></div><p className="truncate text-xs text-zinc-500">{room.lastMessagePreview || 'Start a conversation'}</p></div></Link>})}</section>)}</nav>
      <Link to="/marketplace" className="mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white"><ShoppingBag size={17} />Marketplace</Link>
      <div className="flex items-center gap-2 border-t border-zinc-200 pt-3"><HumanAvatar name={currentUser.name} size={34} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{currentUser.name}</div><Link to="/settings" className="text-xs text-zinc-500">Settings</Link></div><button aria-label="Log out" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); await navigate({ to: '/login' }) }} className="rounded-lg p-2 hover:bg-white"><LogOut size={16} /></button></div>
    </aside>
    {children}
    {groupOpen && <GroupDialog bots={bots} users={users} currentUser={currentUser} onClose={() => setGroupOpen(false)} onCreated={(roomId) => navigate({ to: '/rooms/$roomId', params: { roomId } })} />}
  </main>
}

function GroupDialog({ bots, users, currentUser, onClose, onCreated }: { bots: BotType[]; users: User[]; currentUser: User; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [botIds, setBotIds] = useState<string[]>([])
  const [userIds, setUserIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const toggle = (values: string[], id: string, set: (values: string[]) => void) => set(values.includes(id) ? values.filter((value) => value !== id) : [...values, id])
  const submit = async () => {
    try {
      const response = await api<{ room: RoomView }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name, botIds, userIds }) })
      onCreated(response.room.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create group') }
  }
  return <div className="fixed inset-0 z-30 grid place-items-center bg-black/25 p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">New group</h2><button onClick={onClose} className="text-zinc-400">Close</button></div><label className="mb-4 block text-xs font-medium text-zinc-500">Group name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-zinc-900 outline-none focus:border-zinc-400" /></label><p className="mb-2 text-xs font-medium text-zinc-500">Choose 2 to 6 bots</p><div className="mb-4 grid grid-cols-2 gap-2">{bots.map((bot) => <button key={bot.id} onClick={() => toggle(botIds, bot.id, setBotIds)} className={`flex items-center gap-2 rounded-xl border p-2 text-left ${botIds.includes(bot.id) ? 'border-black bg-zinc-50' : 'border-zinc-200'}`}><BotAvatar {...bot.avatar} size={28} /><span className="truncate">{bot.name}</span></button>)}</div>{users.filter((user) => user.id !== currentUser.id).length > 0 && <><p className="mb-2 text-xs font-medium text-zinc-500">Invite people</p><div className="mb-4">{users.filter((user) => user.id !== currentUser.id).map((user) => <label key={user.id} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={userIds.includes(user.id)} onChange={() => toggle(userIds, user.id, setUserIds)} />{user.name}</label>)}</div></>}{error && <p className="mb-3 text-sm text-red-600">{error}</p>}<button disabled={!name.trim() || botIds.length < 2 || botIds.length > 6} onClick={submit} className="w-full rounded-xl bg-black py-2.5 font-medium text-white">Create group</button></div></div>
}
