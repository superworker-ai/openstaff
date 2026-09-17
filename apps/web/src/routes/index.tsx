import { useCallback } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { messagePreview, type HomeDigest, type HomeFeed, type ServerWireMessage, type User } from '@openstaff/shared'
import { AppShell } from '../components/AppShell'
import { patchSharedRoomFields } from '../components/RoomSections'
import { HomePage } from '../components/home/HomePage'
import { useRoomSocket } from '../hooks/useRoomSocket'
import { api } from '../lib/api'
import { loadHomeFeed, loadMe, loadRooms } from '../lib/loaders'

export const Route = createFileRoute('/')({
  loader: async () => {
    let loaded: Awaited<ReturnType<typeof loadMe>>, roomList: Awaited<ReturnType<typeof loadRooms>>, feed: HomeFeed
    try {
      [loaded, roomList, feed] = await Promise.all([loadMe(), loadRooms(), loadHomeFeed()])
    } catch {
      throw redirect({ to: '/login' })
    }
    if (feed.bots.length === 0) throw redirect({ to: '/bots/new' })
    const users = new Map<string, User>([[loaded.user.id, loaded.user]])
    for (const room of roomList.rooms) for (const member of room.members) {
      if (member.memberKind === 'user' && member.entity && 'email' in member.entity) users.set(member.entity.id, member.entity)
    }
    return { user: loaded.user, rooms: roomList.rooms, users: [...users.values()], feed }
  },
  component: HomeRoute,
})

function HomeRoute() {
  const initial = Route.useLoaderData()
  const queryClient = useQueryClient()
  const feed = useQuery({ queryKey: ['home-feed'], queryFn: () => api<HomeFeed>('/api/home/feed'), initialData: initial.feed, refetchInterval: 15_000 })
  const digest = useQuery({ queryKey: ['home-digest'], queryFn: () => api<HomeDigest>('/api/home/digest'), staleTime: 5 * 60_000 })
  const roomIds = initial.rooms.map((room) => room.id)
  const onEvent = useCallback((event: ServerWireMessage) => {
    if (event.type === 'message.created') patchSharedRoomFields(queryClient, initial.user.id, event.message.roomId, { lastMessageAt: event.message.createdAt, lastMessagePreview: messagePreview(event.message) })
    if (event.type === 'room.updated') patchSharedRoomFields(queryClient, initial.user.id, event.room.id, event.room)
    if (['turn.updated', 'approval.updated', 'automation.updated', 'connection.updated', 'bot.updated'].includes(event.type)) {
      void queryClient.invalidateQueries({ queryKey: ['home-feed'] })
      void queryClient.invalidateQueries({ queryKey: ['home-digest'] })
    }
  }, [initial.user.id, queryClient])
  useRoomSocket({ roomId: roomIds[0] ?? '', roomIds, afterSeqByRoom: Object.fromEntries(roomIds.map((id) => [id, 0])), onEvent, onGap: () => undefined })
  return <AppShell home rooms={initial.rooms} currentUser={initial.user} bots={feed.data.bots} users={initial.users}>
    <HomePage feed={feed.data} digest={digest.data} digestLoading={digest.isLoading} currentUser={initial.user} rooms={initial.rooms} />
  </AppShell>
}
