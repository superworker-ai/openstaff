import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bot, Folder, GripVertical, Home, LogOut, MoreHorizontal, PanelLeft, Plus, Search, Settings, ShoppingBag, Users } from 'lucide-react'
import type { Bot as BotType, User } from '@openstaff/shared'
import type { RoomView } from '../lib/loaders'
import { api, formatTime } from '../lib/api'
import { authClient } from '../lib/auth-client'
import { sortRooms } from '../lib/room-order'
import { responsivePaneOpen } from '../lib/responsive-pane'
import { groupRoomsBySection, ROOM_SECTION_MAX_LENGTH } from '../lib/room-sections'
import { BotAvatar, HumanAvatar } from './BotAvatar'
import { BrandMark } from './BrandMark'
import { BotWorkstation } from './BotWorkstation'
import { RoomSectionsProvider, SectionPicker, useRoomSections } from './RoomSections'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
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

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null
  if (!element) return false
  if (element.closest('input, textarea, select, [role="textbox"]')) return true
  const editable = element.closest('[contenteditable]')
  return editable instanceof HTMLElement && editable.isContentEditable
}

export function AppShell({ rooms, ...props }: Props) {
  return <RoomSectionsProvider userId={props.currentUser.id} initialRooms={rooms}><AppShellContent {...props} /></RoomSectionsProvider>
}

function AppShellContent({ currentRoomId, currentUser, bots, users, home = false, children }: Omit<Props, 'rooms'>) {
  const navigate = useNavigate()
  const { rooms, sectionNames, assignRoom, organizationBusy } = useRoomSections()
  const searchRef = useRef<HTMLInputElement>(null)
  const newSectionTriggerRef = useRef<HTMLButtonElement>(null)
  const roomDialogTriggerRef = useRef<HTMLButtonElement>(null)
  const [search, setSearch] = useState('')
  const [roomListOpen, setRoomListOpen] = useState(false)
  const [wideNavigation, setWideNavigation] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [roomDialog, setRoomDialog] = useState<{ open: boolean; section: string | null; title: 'New room' | 'New group'; instant: boolean }>({ open: false, section: null, title: 'New group', instant: true })
  const [newSectionOpen, setNewSectionOpen] = useState(false)
  const [desktopDrag, setDesktopDrag] = useState(false)
  const [draggingRoomId, setDraggingRoomId] = useState<string | null>(null)
  const [dropSection, setDropSection] = useState<string | null | undefined>(undefined)
  const openRoomDialog = (section: string | null, title: 'New room' | 'New group', trigger?: HTMLButtonElement, openedByPointer = false) => {
    roomDialogTriggerRef.current = trigger ?? null
    setRoomDialog({ open: true, section, title, instant: !openedByPointer })
  }
  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)')
    const updateMedia = () => {
      setWideNavigation(media.matches)
      setRoomListOpen(responsivePaneOpen({ wide: media.matches, stored: localStorage.getItem('openstaff.roomList'), defaultOpen: false }))
    }
    updateMedia()
    media.addEventListener('change', updateMedia)
    return () => media.removeEventListener('change', updateMedia)
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)')
    const updateMedia = () => setDesktopDrag(media.matches)
    updateMedia()
    media.addEventListener('change', updateMedia)
    return () => media.removeEventListener('change', updateMedia)
  }, [])
  const setListOpen = (open: boolean) => {
    setRoomListOpen(open)
    if (typeof window !== 'undefined' && wideNavigation) localStorage.setItem('openstaff.roomList', String(open))
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        if (isEditableTarget(event.target)) return
        event.preventDefault()
        setRoomListOpen((current) => {
          const next = !current
          if (wideNavigation) localStorage.setItem('openstaff.roomList', String(next))
          return next
        })
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [wideNavigation])
  const showSearch = () => {
    setListOpen(true)
    requestAnimationFrame(() => searchRef.current?.focus())
  }
  const filtered = rooms.filter((room) => roomName(room, bots).toLowerCase().includes(search.toLowerCase()))
  const sections = useMemo(() => groupRoomsBySection(sortRooms(filtered), sectionNames), [filtered, sectionNames])
  const sorted = sortRooms(rooms)
  const logout = async () => {
    await authClient.signOut()
    await navigate({ to: '/login' })
  }

  return <main className="relative grid h-[100dvh] grid-cols-[64px_auto_minmax(0,1fr)] overflow-hidden bg-app text-fg max-[639px]:grid-cols-[48px_auto_minmax(0,1fr)]">
    <nav aria-label="Rooms" className="contents">
      <aside className="z-50 flex min-h-0 w-16 flex-col items-center border-r border-line bg-app py-3 max-[639px]:w-[48px] max-[639px]:overflow-y-auto max-[639px]:py-2">
        <Link to="/" aria-label="OpenStaff" className="mb-4 grid h-8 w-8 place-items-center rounded-md text-fg max-[639px]:h-[44px] max-[639px]:w-[44px]"><BrandMark /></Link>
        <div className="flex flex-col gap-1">
          <Tooltip label="Home">
            <Link to="/" aria-label="Home" aria-current={home ? 'page' : undefined} className={`relative grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg max-[639px]:h-[44px] max-[639px]:w-[44px] ${home ? 'bg-surface-3 text-fg' : ''}`}>
              {home && <span className="absolute -left-4 h-6 w-[3px] rounded-r-full bg-fg" />}
              <Home size={17} />
            </Link>
          </Tooltip>
          <IconButton label="Toggle room list" kbd="⌘B" aria-pressed={roomListOpen} onClick={() => setListOpen(!roomListOpen)} className="max-[639px]:h-[44px] max-[639px]:w-[44px]"><PanelLeft size={17} /></IconButton>
          <IconButton label="Search rooms" onClick={showSearch} className="max-[639px]:h-[44px] max-[639px]:w-[44px]"><Search size={17} /></IconButton>
          <DropdownMenu open={createOpen} onOpenChange={setCreateOpen}>
            <DropdownMenuTrigger asChild><span><IconButton label="Create" className="max-[639px]:h-[44px] max-[639px]:w-[44px]"><Plus size={18} /></IconButton></span></DropdownMenuTrigger>
            <DropdownMenuContent label="Create" side="right" align="start">
              <Link to="/bots/new" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-surface-3"><Bot size={15} />New bot</Link>
              <button type="button" onClick={(event) => { setCreateOpen(false); openRoomDialog(null, 'New group', undefined, event.detail > 0) }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-3"><Users size={15} />New group</button>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip label="Marketplace">
            <Link to="/marketplace" aria-label="Marketplace" className="grid h-8 w-8 place-items-center rounded-md text-fg-muted transition-[color,background-color,transform] duration-150 ease-out hover:bg-surface-3 hover:text-fg active:scale-[.97] max-[639px]:h-[44px] max-[639px]:w-[44px]"><ShoppingBag size={17} /></Link>
          </Tooltip>
        </div>
        <div className="my-3 h-px w-8 bg-line" />
        <div className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto px-2 max-[639px]:w-full max-[639px]:px-[2px]" role="list">
          {sorted.map((room) => {
            const name = roomName(room, bots), status = roomStatus(room, bots), active = currentRoomId === room.id
            return <div role="listitem" key={room.id}>
              <Tooltip label={`${name} · ${room.lastMessagePreview || 'Start a conversation'}`}>
                <Link aria-label={name} aria-current={active ? 'page' : undefined} to="/rooms/$roomId" params={{ roomId: room.id }} className={`relative grid h-10 w-10 place-items-center rounded-md max-[639px]:h-[44px] max-[639px]:w-[44px] ${active ? 'bg-surface-3' : 'hover:bg-surface-3'}`}>
                  {active && <span className="absolute -left-2 h-6 w-[3px] rounded-r-full bg-fg" />}
                  <span className="relative"><RoomAvatar room={room} bots={bots} size={34} /><StatusDot status={status} /></span>
                </Link>
              </Tooltip>
            </div>
          })}
        </div>
        <div className="mt-3 flex flex-col items-center gap-2 border-t border-line pt-3">
          <Tooltip label="Settings">
            <Link to="/settings" aria-label="Settings" className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg max-[639px]:h-[44px] max-[639px]:w-[44px]"><Settings size={17} /></Link>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" aria-label="Account menu" className="grid place-items-center rounded-full active:scale-[.97] max-[639px]:h-[44px] max-[639px]:w-[44px]"><HumanAvatar name={currentUser.name} size={32} /></button></DropdownMenuTrigger>
            <DropdownMenuContent label="Account menu" side="right" align="end" className="w-60">
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-medium text-fg">{currentUser.name}</p>
                <p className="truncate text-xs text-fg-muted">{currentUser.email}</p>
              </div>
              <DropdownMenuSeparator />
              <Link to="/security" className="flex w-full items-center rounded-md px-2.5 py-2 text-sm hover:bg-surface-3">Security</Link>
              <button type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-3"><LogOut size={15} />Log out</button>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {roomListOpen && <button type="button" aria-label="Close room list" onClick={() => setListOpen(false)} className="fixed inset-y-0 left-16 right-0 z-30 hidden bg-overlay max-[899px]:block max-[639px]:left-[48px]" />}
      <aside aria-hidden={!roomListOpen} inert={!roomListOpen ? true : undefined} className={`relative z-40 min-h-0 max-w-[272px] overflow-hidden border-r border-line bg-app max-[899px]:fixed max-[899px]:inset-y-0 max-[899px]:left-16 max-[639px]:left-[48px] ${roomListOpen ? 'w-[272px] max-[639px]:w-[calc(100vw-48px)]' : 'w-0 border-r-0'}`}>
        <div className="flex h-full w-[272px] max-w-[calc(100vw-48px)] flex-col">
          <div className="border-b border-line px-4 py-3">
            <div className="mb-2">
              <h2 className="min-h-7 text-sm font-semibold">Rooms</h2>
              <div className="grid grid-cols-2 gap-1.5">
                <button data-testid="new-room-trigger" type="button" onClick={(event) => openRoomDialog(null, 'New room', event.currentTarget, event.detail > 0)} className="new-room-button inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-fg-muted transition-[transform,background-color,color] duration-150 ease-out hover:bg-surface-3 hover:text-fg"><Plus size={13} />New room</button>
                <button ref={newSectionTriggerRef} data-testid="new-section-trigger" type="button" disabled={organizationBusy} onClick={() => setNewSectionOpen(true)} className="new-section-button inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-md border border-line-strong bg-surface-2 px-2 text-[11px] font-semibold text-fg-muted transition-[transform,background-color,color,border-color] duration-150 ease-out hover:bg-surface-3 hover:text-fg"><Plus size={13} />New section</button>
              </div>
            </div>
            <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface-3 px-2.5 text-fg-muted">
              <Search size={14} />
              <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search rooms" className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
            </label>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2" role="list" data-dragging={draggingRoomId ? 'true' : 'false'}>
            {sections.map((group, sectionIndex) => <section
              key={group.key ? `section:${group.key}` : 'unsectioned'}
              data-testid="section-drop-target"
              data-section-name={group.key ?? ''}
              data-drop-active={dropSection === group.key ? 'true' : 'false'}
              className="room-section-drop mb-3 rounded-lg p-1"
              role="group"
              aria-labelledby={`room-section-${sectionIndex}`}
              onDragEnter={(event) => { if (draggingRoomId && !organizationBusy) { event.preventDefault(); setDropSection(group.key) } }}
              onDragOver={(event) => { if (draggingRoomId && !organizationBusy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropSection(group.key) } }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropSection((current) => current === group.key ? undefined : current) }}
              onDrop={(event) => {
                event.preventDefault()
                const roomId = draggingRoomId ?? event.dataTransfer.getData('text/plain')
                setDraggingRoomId(null)
                setDropSection(undefined)
                if (roomId && !organizationBusy) void assignRoom(roomId, group.key)
              }}
            >
              <SectionHeading
                id={`room-section-${sectionIndex}`}
                section={group.key}
                name={group.name}
                count={group.rooms.length}
                onNewRoom={(trigger, openedByPointer) => openRoomDialog(group.key, 'New room', trigger, openedByPointer)}
              />
              {group.rooms.map((room) => {
                const name = roomName(room, bots), active = currentRoomId === room.id, status = roomStatus(room, bots)
                return <div
                  role="listitem"
                  key={room.id}
                  data-testid="room-section-row"
                  data-room-id={room.id}
                  draggable={desktopDrag && !organizationBusy}
                  onDragStart={(event) => {
                    if ((event.target as Element).closest('button')) { event.preventDefault(); return }
                    setDraggingRoomId(room.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', room.id)
                  }}
                  onDragEnd={() => { setDraggingRoomId(null); setDropSection(undefined) }}
                  className={`group mb-1 grid min-h-[52px] grid-cols-[16px_36px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1 ${active ? 'bg-surface-3' : 'hover:bg-surface-3'}`}
                >
                  <span
                    data-testid="room-drag-handle"
                    data-room-id={room.id}
                    aria-hidden="true"
                    className="room-drag-handle grid h-8 place-items-center text-fg-subtle"
                  ><GripVertical size={14} /></span>
                  <Link draggable={false} aria-label={name} aria-current={active ? 'page' : undefined} to="/rooms/$roomId" params={{ roomId: room.id }} onClick={() => { if (window.innerWidth < 900) setListOpen(false) }} className="col-span-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md">
                    <span className="relative"><RoomAvatar room={room} bots={bots} size={36} /><StatusDot status={status} /></span>
                    <span className="min-w-0">
                      <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-fg">{name}</span><time className="shrink-0 text-[11px] text-fg-subtle">{formatTime(room.lastMessageAt)}</time></span>
                      <span className="block truncate text-xs text-fg-muted">{room.lastMessagePreview || 'Start a conversation'}</span>
                    </span>
                  </Link>
                  <SectionPicker roomId={room.id} align="end" restoreMovedRowFocus trigger={<button data-testid="sidebar-room-move" data-room-id={room.id} type="button" disabled={organizationBusy} className="sidebar-room-move h-8 rounded-md px-2 text-[11px] font-medium text-fg-muted opacity-70 hover:bg-surface-4 hover:text-fg hover:opacity-100 focus:opacity-100 group-focus-within:opacity-100">Move</button>} />
                </div>
              })}
              {group.rooms.length === 0 && <div className="room-section-empty mx-1 mb-1 grid min-h-10 place-items-center rounded-md border border-dashed border-line-strong px-2 text-[11px] text-fg-subtle">Drop rooms here</div>}
            </section>)}
          </div>
        </div>
      </aside>
    </nav>
    <div className="col-start-3 h-full min-h-0 min-w-0 overflow-hidden">{children}</div>
    <GroupDialog
      open={roomDialog.open}
      title={roomDialog.title}
      section={roomDialog.section}
      instant={roomDialog.instant}
      returnFocusRef={roomDialogTriggerRef}
      bots={bots}
      users={users}
      currentUser={currentUser}
      onOpenChange={(open) => setRoomDialog((current) => ({ ...current, open }))}
      onKeyboardClose={() => setRoomDialog((current) => ({ ...current, instant: true }))}
      onCreated={(roomId) => navigate({ to: '/rooms/$roomId', params: { roomId } })}
    />
    <NewSectionDialog open={newSectionOpen} returnFocusRef={newSectionTriggerRef} onOpenChange={setNewSectionOpen} />
  </main>
}

function SectionHeading({ id, section, name, count, onNewRoom }: { id: string; section: string | null; name: string; count: number; onNewRoom: (trigger: HTMLButtonElement, openedByPointer: boolean) => void }) {
  const { renameSection, organizationBusy } = useRoomSections()
  const inputRef = useRef<HTMLInputElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const editingFromMenu = useRef(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [menuInstant, setMenuInstant] = useState(true)

  useEffect(() => {
    if (!editing) return
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [editing])

  if (!section) return <h3 id={id} className="section-heading-row flex min-h-7 items-center gap-1.5 px-1.5 text-[11px] font-semibold text-fg-subtle">
    <Folder size={13} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{name}</span><span className="tabular-nums">{count}</span><span className="room-section-drop-label">Drop here</span>
  </h3>

  const restoreMenuFocus = (sectionName = section) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const triggers = document.querySelectorAll<HTMLButtonElement>('[data-testid="section-menu-trigger"]')
      ;[...triggers].find((trigger) => trigger.dataset.sectionName === sectionName)?.focus()
    }))
  }
  const cancel = (restoreFocus: boolean) => {
    if (pending) return
    setEditing(false)
    setDraft(name)
    setError('')
    if (restoreFocus) restoreMenuFocus()
  }
  const submit = async () => {
    if (pending) return
    const nextName = draft.trim()
    if (!nextName) {
      setError(`Section names must be 1 to ${ROOM_SECTION_MAX_LENGTH} characters`)
      inputRef.current?.focus()
      return
    }
    if (nextName === section) {
      cancel(true)
      return
    }
    setPending(true)
    setError('')
    try {
      const savedName = await renameSection(section, nextName)
      setEditing(false)
      restoreMenuFocus(savedName)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename section')
      requestAnimationFrame(() => inputRef.current?.focus())
    } finally {
      setPending(false)
    }
  }
  const beginEditing = () => {
    editingFromMenu.current = true
    setDraft(name)
    setError('')
    setEditing(true)
  }

  return <>
    <h3 id={id} className="section-heading-row flex min-h-7 items-center gap-0.5 px-1.5 text-[11px] font-semibold text-fg-subtle">
      <Folder size={13} className="mr-1 shrink-0" />
      {editing
        ? <input
            ref={inputRef}
            data-testid="section-rename-input"
            data-section-name={section}
            aria-label={`Rename ${name} section`}
            value={draft}
            maxLength={ROOM_SECTION_MAX_LENGTH}
            readOnly={pending}
            onChange={(event) => { setDraft(event.target.value); if (error) setError('') }}
            onBlur={() => cancel(false)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') { event.preventDefault(); void submit() }
              if (event.key === 'Escape') { event.preventDefault(); cancel(true) }
            }}
            className="section-rename-input min-w-0 flex-1 rounded border border-line-strong bg-surface-3 px-1.5 py-1 text-[12px] font-medium text-fg outline-none focus:border-ring"
          />
        : <span className="min-w-0 flex-1 truncate">{name}</span>}
      {pending && <span className="section-rename-pending text-[10px] font-medium text-fg-subtle">Renaming…</span>}
      {!editing && <>
        <span className="mr-0.5 tabular-nums">{count}</span>
        <button
          data-testid="section-new-room"
          data-section-name={section}
          type="button"
          disabled={organizationBusy}
          onClick={(event) => onNewRoom(event.currentTarget, event.detail > 0)}
          aria-label={`New room in ${name}`}
          className="section-heading-action grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg"
        ><Plus size={13} /></button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              ref={menuTriggerRef}
              data-testid="section-menu-trigger"
              data-section-name={section}
              type="button"
              disabled={organizationBusy}
              aria-label={`Section options for ${name}`}
              onPointerDown={() => setMenuInstant(false)}
              onKeyDown={() => setMenuInstant(true)}
              className="section-heading-action grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg"
            ><MoreHorizontal size={15} /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            label={`${name} section actions`}
            align="end"
            data-instant={menuInstant ? 'true' : undefined}
            onKeyDownCapture={() => setMenuInstant(true)}
            onEscapeKeyDown={() => setMenuInstant(true)}
            onCloseAutoFocus={(event) => {
              if (editingFromMenu.current) {
                event.preventDefault()
                editingFromMenu.current = false
              }
            }}
          >
            <DropdownMenuItem data-testid="section-rename-action" onSelect={beginEditing}>Rename</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>}
      <span className="room-section-drop-label">Drop here</span>
    </h3>
    {error && <p data-testid="section-rename-error" role="alert" className="px-6 pb-1 pt-0.5 text-[11px] leading-4 text-danger">{error}</p>}
  </>
}

function NewSectionDialog({ open, returnFocusRef, onOpenChange }: { open: boolean; returnFocusRef: React.RefObject<HTMLButtonElement | null>; onOpenChange: (open: boolean) => void }) {
  const { createSection } = useRoomSections()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => { setName(''); setError(''); onOpenChange(false) }
  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true); setError('')
    try { await createSection(name); close() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create section') }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
    <DialogContent label="New section" data-testid="new-section-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus() }} className="p-6">
      <div className="mb-5 flex items-center justify-between gap-3"><DialogTitle className="text-lg font-semibold">New section</DialogTitle><button type="button" onClick={close} className="text-sm text-fg-muted hover:text-fg">Close</button></div>
      <label className="block text-xs font-medium text-fg-muted">Section name<input autoFocus value={name} maxLength={ROOM_SECTION_MAX_LENGTH} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submit() } }} placeholder="For example, Product" className="mt-1 w-full rounded-md border border-line-strong bg-surface-3 px-3 py-2.5 text-fg outline-none placeholder:text-fg-subtle" /></label>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <button data-testid="new-section-submit" type="button" disabled={!name.trim() || busy} onClick={() => void submit()} className="mt-5 w-full rounded-md bg-accent py-2.5 font-medium text-accent-fg">{busy ? 'Creating…' : 'Create section'}</button>
    </DialogContent>
  </Dialog>
}

function GroupDialog({ open, title, section, instant, returnFocusRef, bots, users, currentUser, onOpenChange, onKeyboardClose, onCreated }: { open: boolean; title: 'New room' | 'New group'; section: string | null; instant: boolean; returnFocusRef: React.RefObject<HTMLButtonElement | null>; bots: BotType[]; users: User[]; currentUser: User; onOpenChange: (open: boolean) => void; onKeyboardClose: () => void; onCreated: (id: string) => void }) {
  const { registerRoom } = useRoomSections()
  const [name, setName] = useState('')
  const [botIds, setBotIds] = useState<string[]>([])
  const [userIds, setUserIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  useEffect(() => {
    if (!open) return
    setName('')
    setBotIds([])
    setUserIds([])
    setError('')
    setBusy(false)
    busyRef.current = false
  }, [open, section, title])
  const toggle = (values: string[], id: string, set: (values: string[]) => void) => set(values.includes(id) ? values.filter((value) => value !== id) : [...values, id])
  const submit = async () => {
    if (busyRef.current || !name.trim() || botIds.length < 2 || botIds.length > 6) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const response = await api<{ room: RoomView }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name, botIds, userIds, section }) })
      await registerRoom(response.room)
      busyRef.current = false
      onOpenChange(false)
      onCreated(response.room.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create room')
      busyRef.current = false
      setBusy(false)
    }
  }
  const otherUsers = users.filter((user) => user.id !== currentUser.id)
  return <Dialog open={open} onOpenChange={(next) => { if (!next && busyRef.current) return; onOpenChange(next) }}>
    <DialogContent label={title} data-testid="new-room-dialog" data-instant={instant ? 'true' : undefined} overlayClassName={instant ? 'ui-dialog-overlay-instant' : ''} onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); else onKeyboardClose() }} onInteractOutside={(event) => { if (busyRef.current) event.preventDefault() }} onCloseAutoFocus={(event) => { if (returnFocusRef.current) { event.preventDefault(); returnFocusRef.current.focus() } }} className="p-6">
      <div className="mb-5 flex items-center justify-between"><DialogTitle className="text-lg font-semibold">{title}</DialogTitle><button type="button" disabled={busy} onClick={(event) => { if (event.detail === 0) onKeyboardClose(); onOpenChange(false) }} className="text-sm text-fg-muted hover:text-fg">Close</button></div>
      {section && <p className="mb-4 flex items-center gap-1.5 text-xs text-fg-muted"><Folder size={13} />{section}</p>}
      <label className="mb-4 block text-xs font-medium text-fg-muted">{title === 'New group' ? 'Group name' : 'Room name'}<input autoFocus data-testid="new-room-name" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter' && botIds.length >= 2 && botIds.length <= 6) { event.preventDefault(); void submit() } }} className="mt-1 w-full rounded-md border border-line-strong bg-surface-3 px-3 py-2.5 text-fg outline-none" /></label>
      <p className="mb-2 text-xs font-medium text-fg-muted">Choose 2 to 6 bots</p>
      <div className="mb-4 grid grid-cols-2 gap-2">{bots.map((bot) => <button data-testid="new-room-bot" data-bot-id={bot.id} type="button" key={bot.id} disabled={busy} aria-pressed={botIds.includes(bot.id)} onClick={() => toggle(botIds, bot.id, setBotIds)} className="flex items-center gap-2 rounded-md border border-line bg-surface-3 p-2 text-left aria-pressed:border-line-strong aria-pressed:bg-surface-4"><BotAvatar {...bot.avatar} size={28} label={bot.name} /><span className="truncate">{bot.name}</span></button>)}</div>
      {otherUsers.length > 0 && <><p className="mb-2 text-xs font-medium text-fg-muted">Invite people</p><div className="mb-4">{otherUsers.map((user) => <label key={user.id} className="mr-3 inline-flex items-center gap-1 text-sm"><input type="checkbox" disabled={busy} checked={userIds.includes(user.id)} onChange={() => toggle(userIds, user.id, setUserIds)} />{user.name}</label>)}</div></>}
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      <button data-testid="new-room-submit" type="button" disabled={busy || !name.trim() || botIds.length < 2 || botIds.length > 6} onClick={() => void submit()} className="w-full rounded-md bg-accent py-2.5 font-medium text-accent-fg">{busy ? 'Creating…' : title === 'New group' ? 'Create group' : 'Create room'}</button>
    </DialogContent>
  </Dialog>
}
