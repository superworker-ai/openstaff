import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bot, Home, LogOut, PanelLeft, Plus, Search, Settings, ShoppingBag, Users } from 'lucide-react'
import type { Bot as BotType, User } from '@openstaff/shared'
import type { RoomView } from '../lib/loaders'
import { api, formatTime } from '../lib/api'
import { sortRooms } from '../lib/room-order'
import { BotAvatar, HumanAvatar } from './BotAvatar'
import { BrandMark } from './BrandMark'
import { BotWorkstation } from './BotWorkstation'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { IconButton } from './ui/icon-button'
import { Tooltip } from './ui/tooltip'

interface Props {
  rooms: RoomView[]
  currentRoomId?: string
  currentUser: User
  bots: BotType[]
  users: User[]
  home?: boolean
  children: React.ReactNode
}

function roomBots(room: RoomView, bots?: BotType[]): BotType[] {
  return room.members
    .filter((member) => member.memberKind === 'bot')
    .map((member) => bots?.find((bot) => bot.id === member.memberId) ?? member.entity)
    .filter((entity): entity is BotType => Boolean(entity && 'job' in entity))
}

function roomStatus(room: RoomView, bots: BotType[]): BotType['status'] | undefined {
  const members = roomBots(room, bots)
  return members.find((bot) => bot.status === 'waiting_approval')?.status
    ?? members.find((bot) => bot.status === 'working')?.status
}

function RoomAvatar({ room, bots, size }: { room: RoomView; bots: BotType[]; size: number }) {
  const members = roomBots(room, bots), bot = members[0]
  if (room.kind === 'dm' && bot) {
    return bot.status === 'working' || bot.status === 'waiting_approval'
      ? <BotWorkstation {...bot.avatar} size={size} state={bot.status === 'working' ? 'working' : 'waiting'} identity={`${bot.id}:${bot.status}`} label={bot.name} />
      : <BotAvatar {...bot.avatar} size={size} label={bot.name} animate />
  }
  const shown = members.slice(0, 3)
  return <div className="relative shrink-0" style={{ width: size + Math.max(0, shown.length - 1) * 9, height: size }}>
    {shown.map((member, index) => <div key={member.id} className="absolute rounded-full border-2 border-surface-2" style={{ left: index * 9, zIndex: shown.length - index }}><BotAvatar {...member.avatar} size={size - 2} label={member.name} animate /></div>)}
  </div>
}

function StatusDot({ status }: { status?: BotType['status'] }) {
  if (status !== 'working' && status !== 'waiting_approval') return null
  return <span aria-hidden="true" className={`absolute bottom-0 right-0 h-[9px] w-[9px] rounded-full border-2 border-app ${status === 'working' ? 'bg-working' : 'bg-waiting motion-safe:animate-pulse'}`} />
}

function roomName(room: RoomView, bots: BotType[]) {
  return room.name ?? roomBots(room, bots)[0]?.name ?? 'Room'
}

export function AppShell({ rooms, currentRoomId, currentUser, bots, users, home = false, children }: Props) {
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [roomListOpen, setRoomListOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') setRoomListOpen(localStorage.getItem('openstaff.roomList') === 'true')
  }, [])
  const setListOpen = (open: boolean) => {
    setRoomListOpen(open)
    if (typeof window !== 'undefined') localStorage.setItem('openstaff.roomList', String(open))
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setRoomListOpen((current) => {
          const next = !current
          localStorage.setItem('openstaff.roomList', String(next))
          return next
        })
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  const showSearch = () => {
    setListOpen(true)
    requestAnimationFrame(() => searchRef.current?.focus())
  }
  const filtered = rooms.filter((room) => roomName(room, bots).toLowerCase().includes(search.toLowerCase()))
  const sections = useMemo(() => {
    const groups = new Map<string, RoomView[]>()
    for (const room of sortRooms(filtered)) {
      const key = room.section || 'Unassigned'
      groups.set(key, [...(groups.get(key) ?? []), room])
    }
    return [...groups.entries()]
  }, [filtered])
  const sorted = sortRooms(rooms)
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' })
    await navigate({ to: '/login' })
  }

  return <main className="relative grid h-screen grid-cols-[64px_auto_minmax(0,1fr)] overflow-hidden bg-app text-fg">
    <nav aria-label="Rooms" className="contents">
      <aside className="z-50 flex min-h-0 w-16 flex-col items-center border-r border-line bg-app py-3">
        <Link to="/" aria-label="OpenStaff" className="mb-4 grid h-8 w-8 place-items-center rounded-md text-fg"><BrandMark /></Link>
        <div className="flex flex-col gap-1">
          <Tooltip label="Home">
            <Link to="/" aria-label="Home" aria-current={home ? 'page' : undefined} className={`relative grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg ${home ? 'bg-surface-3 text-fg' : ''}`}>
              {home && <span className="absolute -left-4 h-6 w-[3px] rounded-r-full bg-fg" />}
              <Home size={17} />
            </Link>
          </Tooltip>
          <IconButton label="Toggle room list" kbd="⌘B" aria-pressed={roomListOpen} onClick={() => setListOpen(!roomListOpen)}><PanelLeft size={17} /></IconButton>
          <IconButton label="Search rooms" onClick={showSearch}><Search size={17} /></IconButton>
          <DropdownMenu open={createOpen} onOpenChange={setCreateOpen}>
            <DropdownMenuTrigger asChild><span><IconButton label="Create"><Plus size={18} /></IconButton></span></DropdownMenuTrigger>
            <DropdownMenuContent label="Create" side="right" align="start">
              <Link to="/bots/new" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-surface-3"><Bot size={15} />New bot</Link>
              <button type="button" onClick={() => { setCreateOpen(false); setGroupOpen(true) }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-3"><Users size={15} />New group</button>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip label="Marketplace">
            <Link to="/marketplace" aria-label="Marketplace" className="grid h-8 w-8 place-items-center rounded-md text-fg-muted transition-[color,background-color,transform] duration-150 ease-out hover:bg-surface-3 hover:text-fg active:scale-[.97]"><ShoppingBag size={17} /></Link>
          </Tooltip>
        </div>
        <div className="my-3 h-px w-8 bg-line" />
        <div className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto px-2" role="list">
          {sorted.map((room) => {
            const name = roomName(room, bots), status = roomStatus(room, bots), active = currentRoomId === room.id
            return <div role="listitem" key={room.id}>
              <Tooltip label={`${name} · ${room.lastMessagePreview || 'Start a conversation'}`}>
                <Link aria-label={name} aria-current={active ? 'page' : undefined} to="/rooms/$roomId" params={{ roomId: room.id }} className={`relative grid h-10 w-10 place-items-center rounded-md ${active ? 'bg-surface-3' : 'hover:bg-surface-3'}`}>
                  {active && <span className="absolute -left-2 h-6 w-[3px] rounded-r-full bg-fg" />}
                  <span className="relative"><RoomAvatar room={room} bots={bots} size={34} /><StatusDot status={status} /></span>
                </Link>
              </Tooltip>
            </div>
          })}
        </div>
        <div className="mt-3 flex flex-col items-center gap-2 border-t border-line pt-3">
          <Tooltip label="Settings">
            <Link to="/settings" aria-label="Settings" className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"><Settings size={17} /></Link>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" aria-label="Account menu" className="rounded-full active:scale-[.97]"><HumanAvatar name={currentUser.name} size={32} /></button></DropdownMenuTrigger>
            <DropdownMenuContent label="Account menu" side="right" align="end" className="w-60">
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-medium text-fg">{currentUser.name}</p>
                <p className="truncate text-xs text-fg-muted">{currentUser.email}</p>
              </div>
              <DropdownMenuSeparator />
              <button type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-3"><LogOut size={15} />Log out</button>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {roomListOpen && <button type="button" aria-label="Close room list" onClick={() => setListOpen(false)} className="fixed inset-y-0 left-16 right-0 z-30 hidden bg-overlay max-[899px]:block" />}
      <aside aria-hidden={!roomListOpen} inert={!roomListOpen ? true : undefined} className={`relative z-40 min-h-0 overflow-hidden border-r border-line bg-app max-[899px]:fixed max-[899px]:inset-y-0 max-[899px]:left-16 ${roomListOpen ? 'w-[272px]' : 'w-0 border-r-0'}`}>
        <div className="flex h-full w-[272px] flex-col">
          <div className="border-b border-line px-4 py-3">
            <h2 className="mb-2 text-sm font-semibold">Rooms</h2>
            <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface-3 px-2.5 text-fg-muted">
              <Search size={14} />
              <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search rooms" className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
            </label>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2" role="list">
            {sections.map(([section, values]) => <section key={section} className="mb-4" role="group" aria-labelledby={`section-${section.replace(/\s+/g, '-').toLowerCase()}`}>
              <h3 id={`section-${section.replace(/\s+/g, '-').toLowerCase()}`} className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{section}</h3>
              {values.map((room) => {
                const name = roomName(room, bots), active = currentRoomId === room.id, status = roomStatus(room, bots)
                return <div role="listitem" key={room.id}>
                  <Link aria-label={name} aria-current={active ? 'page' : undefined} to="/rooms/$roomId" params={{ roomId: room.id }} onClick={() => { if (window.innerWidth < 900) setListOpen(false) }} className={`mb-1 grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md p-2 ${active ? 'bg-surface-3' : 'hover:bg-surface-3'}`}>
                    <span className="relative"><RoomAvatar room={room} bots={bots} size={36} /><StatusDot status={status} /></span>
                    <span className="min-w-0">
                      <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-fg">{name}</span><time className="shrink-0 text-[11px] text-fg-subtle">{formatTime(room.lastMessageAt)}</time></span>
                      <span className="block truncate text-xs text-fg-muted">{room.lastMessagePreview || 'Start a conversation'}</span>
                    </span>
                  </Link>
                </div>
              })}
            </section>)}
          </div>
        </div>
      </aside>
    </nav>
    <div className="min-h-0 min-w-0">{children}</div>
    <GroupDialog open={groupOpen} bots={bots} users={users} currentUser={currentUser} onOpenChange={setGroupOpen} onCreated={(roomId) => navigate({ to: '/rooms/$roomId', params: { roomId } })} />
  </main>
}

function GroupDialog({ open, bots, users, currentUser, onOpenChange, onCreated }: { open: boolean; bots: BotType[]; users: User[]; currentUser: User; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [botIds, setBotIds] = useState<string[]>([])
  const [userIds, setUserIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const toggle = (values: string[], id: string, set: (values: string[]) => void) => set(values.includes(id) ? values.filter((value) => value !== id) : [...values, id])
  const submit = async () => {
    try {
      const response = await api<{ room: RoomView }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name, botIds, userIds }) })
      onOpenChange(false)
      onCreated(response.room.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create group') }
  }
  const otherUsers = users.filter((user) => user.id !== currentUser.id)
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent label="New group" className="p-6">
      <div className="mb-5 flex items-center justify-between"><DialogTitle className="text-lg font-semibold">New group</DialogTitle><button type="button" onClick={() => onOpenChange(false)} className="text-sm text-fg-muted hover:text-fg">Close</button></div>
      <label className="mb-4 block text-xs font-medium text-fg-muted">Group name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md border border-line-strong bg-surface-3 px-3 py-2.5 text-fg outline-none" /></label>
      <p className="mb-2 text-xs font-medium text-fg-muted">Choose 2 to 6 bots</p>
      <div className="mb-4 grid grid-cols-2 gap-2">{bots.map((bot) => <button type="button" key={bot.id} aria-pressed={botIds.includes(bot.id)} onClick={() => toggle(botIds, bot.id, setBotIds)} className="flex items-center gap-2 rounded-md border border-line bg-surface-3 p-2 text-left aria-pressed:border-line-strong aria-pressed:bg-surface-4"><BotAvatar {...bot.avatar} size={28} label={bot.name} /><span className="truncate">{bot.name}</span></button>)}</div>
      {otherUsers.length > 0 && <><p className="mb-2 text-xs font-medium text-fg-muted">Invite people</p><div className="mb-4">{otherUsers.map((user) => <label key={user.id} className="mr-3 inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={userIds.includes(user.id)} onChange={() => toggle(userIds, user.id, setUserIds)} />{user.name}</label>)}</div></>}
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      <button type="button" disabled={!name.trim() || botIds.length < 2 || botIds.length > 6} onClick={() => void submit()} className="w-full rounded-md bg-accent py-2.5 font-medium text-accent-fg">Create group</button>
    </DialogContent>
  </Dialog>
}
