import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { messagePreview } from '@openstaff/shared'
import type { Approval, Bot, Message, PublicTurn, ServerWireMessage, Task, TurnEvent, User } from '@openstaff/shared'
import { AppShell } from '../components/AppShell'
import { ComputerPane } from '../components/ComputerPane'
import { RoomSettings } from '../components/RoomSettings'
import { Thread } from '../components/Thread'
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog'
import { useRoomSocket } from '../hooks/useRoomSocket'
import { api } from '../lib/api'
import { loadMe, loadRoomData, type RoomData, type RoomView } from '../lib/loaders'
import { responsivePaneOpen } from '../lib/responsive-pane'

const SSR_LAYOUT_STORAGE = { getItem: () => null, setItem: () => undefined }

export const Route = createFileRoute('/rooms/$roomId')({
  validateSearch: (search: Record<string, unknown>): { computer?: 1 } => ({ computer: search.computer === '1' || search.computer === 1 ? 1 : undefined }),
  loader: async ({ params }) => {
    try {
      const [data, me] = await Promise.all([loadRoomData({ data: { roomId: params.roomId } }), loadMe()])
      return { data, user: me.user }
    } catch { throw redirect({ to: '/login' }) }
  },
  component: RoomPage,
})

async function fetchRoomData(roomId: string): Promise<RoomData> {
  const [room, roomList, messageList, turnList, botList, userList, taskList, approvalList] = await Promise.all([
    api<{ room: RoomView }>(`/api/rooms/${roomId}`), api<{ rooms: RoomView[] }>('/api/rooms'),
    api<{ messages: Message[] }>(`/api/rooms/${roomId}/messages?limit=200`), api<{ turns: PublicTurn[] }>(`/api/rooms/${roomId}/turns`),
    api<{ bots: Bot[] }>('/api/bots'), api<{ users: User[] }>('/api/users'), api<{ tasks: Task[] }>(`/api/tasks?roomId=${encodeURIComponent(roomId)}`),
    api<{ approvals: Approval[] }>(`/api/approvals?roomId=${encodeURIComponent(roomId)}`),
  ])
  return { room: room.room, rooms: roomList.rooms, messages: messageList.messages, turns: turnList.turns, bots: botList.bots, users: userList.users, tasks: taskList.tasks, approvals: approvalList.approvals }
}

function RoomPage() {
  const { roomId } = Route.useParams()
  const search = Route.useSearch()
  const initial = Route.useLoaderData()
  const queryClient = useQueryClient()
  const key = ['room-data', roomId]
  const query = useQuery({ queryKey: key, queryFn: () => fetchRoomData(roomId), initialData: initial.data })
  const data = query.data
  const [computerOpen, setComputerOpen] = useState(search.computer === 1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [liveEvents, setLiveEvents] = useState<TurnEvent[]>([])
  const [pending, setPending] = useState<Record<string, string>>({})
  const setComputer = useCallback((open: boolean) => {
    setComputerOpen(open)
    if (typeof window !== 'undefined' && isDesktop) localStorage.setItem('openstaff.computerOpen', String(open))
  }, [isDesktop])
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const updateMedia = () => {
      setIsDesktop(media.matches)
      setComputerOpen(responsivePaneOpen({
        wide: media.matches,
        stored: localStorage.getItem('openstaff.computerOpen'),
        defaultOpen: true,
        requested: search.computer === 1,
      }))
    }
    updateMedia()
    media.addEventListener('change', updateMedia)
    return () => media.removeEventListener('change', updateMedia)
  }, [roomId, search.computer])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '.') {
        event.preventDefault()
        setComputerOpen((current) => {
          const next = !current
          if (isDesktop) localStorage.setItem('openstaff.computerOpen', String(next))
          return next
        })
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [isDesktop])
  useEffect(() => {
    if (!dragging) return
    const stopDragging = () => setDragging(false)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)
    return () => { window.removeEventListener('pointerup', stopDragging); window.removeEventListener('pointercancel', stopDragging) }
  }, [dragging])
  const savedLayout = useDefaultLayout({ id: 'room-layout', storage: typeof window === 'undefined' ? SSR_LAYOUT_STORAGE : localStorage, panelIds: computerOpen && isDesktop ? ['thread', 'computer'] : ['thread'] })
  const update = useCallback((producer: (current: RoomData) => RoomData) => queryClient.setQueryData<RoomData>(key, (current) => current ? producer(current) : current), [queryClient, roomId])
  const onEvent = useCallback((event: ServerWireMessage) => {
    if (event.type === 'connection.updated') {
      for (const key of ['connection-apps', 'connections', 'plugin-servers', 'marketplace-apps', 'onboarding']) void queryClient.invalidateQueries({ queryKey: [key] })
    } else if (event.type === 'automation.updated') {
      void queryClient.invalidateQueries({ queryKey: ['automations', event.roomId] })
    } else if (event.type === 'turn.event' && event.roomId === roomId) {
      setLiveEvents((current) => [...current, event.event].slice(-2000))
    } else if (event.type === 'message.delta' && event.roomId === roomId) {
      setPending((current) => ({ ...current, [event.turnId]: event.text }))
    } else if (event.type === 'message.created') {
      update((current) => ({ ...current, messages: event.message.roomId !== roomId || current.messages.some((message) => message.id === event.message.id) ? current.messages : [...current.messages, event.message], rooms: current.rooms.map((room) => room.id === event.message.roomId ? { ...room, lastMessageAt: event.message.createdAt, lastMessagePreview: messagePreview(event.message) } : room) }))
      if (event.message.turnId) setPending((current) => { const next = { ...current }; delete next[event.message.turnId!]; return next })
    } else if (event.type === 'turn.updated') {
      update((current) => {
        const turns = event.turn.roomId !== roomId ? current.turns : current.turns.some((turn) => turn.id === event.turn.id) ? current.turns.map((turn) => turn.id === event.turn.id ? event.turn : turn) : [...current.turns, event.turn]
        const status: Bot['status'] = event.turn.status === 'running' ? 'working' : event.turn.status === 'waiting_approval' ? 'waiting_approval' : 'idle'
        const bots = current.bots.map((bot) => bot.id === event.turn.botId ? { ...bot, status } : bot)
        const refresh = (room: RoomView): RoomView => ({ ...room, members: room.members.map((member) => member.memberKind === 'bot' && member.memberId === event.turn.botId && member.entity && 'job' in member.entity ? { ...member, entity: { ...member.entity, status } } : member) })
        return { ...current, turns, bots, room: refresh(current.room), rooms: current.rooms.map(refresh) }
      })
      if (['done', 'failed', 'skipped', 'cancelled'].includes(event.turn.status)) setPending((current) => { const next = { ...current }; delete next[event.turn.id]; return next })
    } else if (event.type === 'approval.updated' && event.approval.roomId === roomId) {
      update((current) => ({ ...current, approvals: current.approvals.some((item) => item.id === event.approval.id) ? current.approvals.map((item) => item.id === event.approval.id ? event.approval : item) : [...current.approvals, event.approval] }))
    } else if (event.type === 'task.updated' && event.task.roomId === roomId) {
      update((current) => ({ ...current, tasks: current.tasks.some((task) => task.id === event.task.id) ? current.tasks.map((task) => task.id === event.task.id ? event.task : task) : [...current.tasks, event.task] }))
    } else if (event.type === 'room.updated' && event.room.id === roomId) {
      update((current) => ({ ...current, room: { ...current.room, ...event.room }, rooms: current.rooms.map((room) => room.id === event.room.id ? { ...room, ...event.room } : room) }))
    } else if (event.type === 'bot.updated') {
      update((current) => {
        const refreshMembers = (members: RoomView['members']) => members.map((member) => member.memberKind === 'bot' && member.memberId === event.bot.id ? { ...member, entity: event.bot } : member)
        return { ...current, bots: current.bots.map((bot) => bot.id === event.bot.id ? event.bot : bot), room: { ...current.room, members: refreshMembers(current.room.members) }, rooms: current.rooms.map((room) => ({ ...room, members: refreshMembers(room.members) })) }
      })
    }
  }, [roomId, update])
  const afterSeq = data.messages.at(-1)?.seq ?? 0
  const roomIds = data.rooms.map((room) => room.id)
  const socket = useRoomSocket({ roomId, roomIds, afterSeqByRoom: Object.fromEntries(roomIds.map((id) => [id, id === roomId ? afterSeq : 0])), onEvent, onGap: (gapRoomId, gap) => update((current) => gapRoomId === roomId ? { ...current, messages: [...current.messages, ...gap.filter((message) => !current.messages.some((item) => item.id === message.id))].sort((a, b) => a.seq - b.seq) } : { ...current, rooms: current.rooms.map((room) => { const latest = gap.at(-1); return room.id === gapRoomId && latest ? { ...room, lastMessageAt: latest.createdAt, lastMessagePreview: messagePreview(latest) } : room }) }) })
  const computerPane = useMemo(() => <ComputerPane room={data.room} bots={data.bots} turns={data.turns} tasks={data.tasks} liveEvents={liveEvents} me={initial.user} onClose={() => setComputer(false)} />, [data.room, data.bots, data.turns, data.tasks, liveEvents, initial.user, setComputer])
  const thread = <Thread room={data.room} user={initial.user} bots={data.bots} users={data.users} presence={socket.presence} messages={data.messages} turns={data.turns} approvals={data.approvals} pending={pending} computerOpen={computerOpen} membersOpen={membersOpen} onMembersOpenChange={setMembersOpen} onOpenMembers={() => setMembersOpen(true)} onMembersChanged={() => void query.refetch()} onSent={(message, newTurns) => update((current) => ({ ...current, messages: current.messages.some((item) => item.id === message.id) ? current.messages : [...current.messages, message], turns: [...current.turns, ...newTurns.filter((turn) => !current.turns.some((item) => item.id === turn.id))] }))} onApproval={(approval) => update((current) => ({ ...current, approvals: current.approvals.map((item) => item.id === approval.id ? approval : item) }))} onSettings={() => setSettingsOpen(true)} onToggleComputer={() => setComputer(!computerOpen)} onShowComputer={() => setComputer(true)} />
  return <AppShell rooms={data.rooms} currentRoomId={roomId} currentUser={initial.user} bots={data.bots} users={data.users}>
    <div className="h-full min-h-0 min-w-0">
      <Group id="room-layout" orientation="horizontal" className={`h-full min-h-0 ${dragging ? '[&_iframe]:pointer-events-none' : ''}`} defaultLayout={savedLayout.defaultLayout} onLayoutChanged={savedLayout.onLayoutChanged} resizeTargetMinimumSize={{ coarse: 16, fine: 8 }}>
        <Panel id="thread" minSize="38%" className="h-full min-h-0">{thread}</Panel>
        {isDesktop && computerOpen && <><Separator id="room-computer-separator" onPointerDown={() => setDragging(true)} className={`relative z-20 w-px bg-line after:absolute after:-left-[3px] after:inset-y-0 after:w-[7px] hover:bg-line-strong ${dragging ? 'bg-fg' : ''}`} /><Panel id="computer" defaultSize="48%" minSize="30%" maxSize="65%" className="h-full min-h-0">{computerPane}</Panel></>}
      </Group>
      {!isDesktop && <Dialog open={computerOpen} onOpenChange={(open) => { if (!open) setComputer(false) }}>
        <DialogContent label="Computer" className="ui-sheet-content !bottom-0 !left-auto !right-0 !top-0 !h-[100dvh] !max-h-none !w-[min(100vw,760px)] !max-w-none !translate-x-0 !translate-y-0 !rounded-none !border-y-0 !border-r-0 !bg-surface !p-0">
          <DialogTitle className="sr-only">Computer</DialogTitle>
          {computerPane}
        </DialogContent>
      </Dialog>}
    </div>
    {settingsOpen && <RoomSettings room={data.room} onClose={() => setSettingsOpen(false)} onChanged={() => query.refetch()} />}
  </AppShell>
}
