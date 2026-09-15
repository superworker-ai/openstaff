import { useCallback, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { messagePreview } from '@openstaff/shared'
import type { Approval, Bot, Message, PublicTurn, ServerWireMessage, Task, TurnEvent, User } from '@openstaff/shared'
import { AppShell } from '../components/AppShell'
import { RightPanel } from '../components/RightPanel'
import { RoomSettings } from '../components/RoomSettings'
import { Thread } from '../components/Thread'
import { useRoomSocket } from '../hooks/useRoomSocket'
import { api } from '../lib/api'
import { loadMe, loadRoomData, type RoomData, type RoomView } from '../lib/loaders'
import { authRedirect } from '../lib/api-error'

export const Route = createFileRoute('/rooms/$roomId')({
  loader: async ({ params }) => {
    try {
      const [data, me] = await Promise.all([loadRoomData({ data: { roomId: params.roomId } }), loadMe()])
      return { data, user: me.user }
    } catch (reason) { throw redirect({ to: authRedirect(reason) }) }
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
  const initial = Route.useLoaderData()
  const queryClient = useQueryClient()
  const key = ['room-data', roomId]
  const query = useQuery({ queryKey: key, queryFn: () => fetchRoomData(roomId), initialData: initial.data })
  const data = query.data
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelTab, setPanelTab] = useState<'members' | 'computer'>('members')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [liveEvents, setLiveEvents] = useState<TurnEvent[]>([])
  const [pending, setPending] = useState<Record<string, string>>({})
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
  return <AppShell rooms={data.rooms} currentRoomId={roomId} currentUser={initial.user} bots={data.bots} users={data.users}><div className={`grid min-h-0 ${panelOpen ? 'grid-cols-[minmax(420px,1fr)_300px]' : 'grid-cols-1'}`}><Thread room={data.room} user={initial.user} messages={data.messages} turns={data.turns} approvals={data.approvals} pending={pending} onSent={(message, newTurns) => update((current) => ({ ...current, messages: current.messages.some((item) => item.id === message.id) ? current.messages : [...current.messages, message], turns: [...current.turns, ...newTurns.filter((turn) => !current.turns.some((item) => item.id === turn.id))] }))} onApproval={(approval) => update((current) => ({ ...current, approvals: current.approvals.map((item) => item.id === approval.id ? approval : item) }))} onSettings={() => setSettingsOpen(true)} onTogglePanel={() => setPanelOpen((value) => !value)} onShowComputer={() => { setPanelOpen(true); setPanelTab('computer') }} />{panelOpen && <RightPanel liveEvents={liveEvents} room={data.room} bots={data.bots} users={data.users} turns={data.turns} tasks={data.tasks} presence={socket.presence} onChanged={() => query.refetch()} me={initial.user} tab={panelTab} onTab={setPanelTab} />}</div>{settingsOpen && <RoomSettings room={data.room} onClose={() => setSettingsOpen(false)} onChanged={() => query.refetch()} />}</AppShell>
}
