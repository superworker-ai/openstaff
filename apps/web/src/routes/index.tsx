import { createFileRoute, redirect } from '@tanstack/react-router'
import { loadRooms, type RoomView } from '../lib/loaders'
import { authRedirect } from '../lib/server-api'

export const Route = createFileRoute('/')({
  loader: async () => {
    let rooms: RoomView[]
    try {
      rooms = (await loadRooms()).rooms
    } catch (reason) {
      throw redirect({ to: authRedirect(reason) })
    }
    if (rooms[0]) throw redirect({ to: '/rooms/$roomId', params: { roomId: rooms[0].id } })
    throw redirect({ to: '/bots/new' })
  },
})
