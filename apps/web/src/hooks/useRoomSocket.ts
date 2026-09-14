import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { serverWireMessageSchema, type Message, type ServerWireMessage } from '@openstaff/shared'
import { api } from '../lib/api'

interface Options {
  roomId: string
  roomIds: string[]
  afterSeqByRoom: Record<string, number>
  onEvent: (event: ServerWireMessage) => void
  onGap: (roomId: string, messages: Message[]) => void
}

export function useRoomSocket({ roomId, roomIds, afterSeqByRoom, onEvent, onGap }: Options) {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)
  const [presence, setPresence] = useState<Array<{ id: string; name: string }>>([])
  const callbackRef = useRef({ onEvent, onGap, afterSeqByRoom })
  callbackRef.current = { onEvent, onGap, afterSeqByRoom }

  useEffect(() => {
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let attempt = 0

    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${location.host}/ws`)
      socket.onopen = async () => {
        attempt = 0
        setConnected(true)
        socket?.send(JSON.stringify({ type: 'subscribe', roomIds }))
        await Promise.all(roomIds.map(async (id) => {
          try {
            const gap = await api<{ messages: Message[] }>(`/api/rooms/${id}/messages?after=${callbackRef.current.afterSeqByRoom[id] ?? 0}&limit=200`)
            callbackRef.current.onGap(id, gap.messages)
          } catch { /* reconnect will retry the snapshot */ }
        }))
      }
      socket.onmessage = (message) => {
        let value: unknown
        try { value = JSON.parse(message.data as string) } catch { return }
        const parsed = serverWireMessageSchema.safeParse(value)
        if (!parsed.success) return
        if (parsed.data.type === 'computer.lease') {
          queryClient.setQueryData(['computer-lease'], parsed.data.lease)
          void queryClient.invalidateQueries({ queryKey: ['computer-status'] })
        }
        if (parsed.data.type === 'computer.notice') void queryClient.invalidateQueries({ queryKey: ['computer-status'] })
        if (parsed.data.type === 'computer.storage') queryClient.setQueryData(['computer-storage'], parsed.data.storage)
        if (parsed.data.type === 'presence' && parsed.data.roomId === roomId) setPresence(parsed.data.users)
        callbackRef.current.onEvent(parsed.data)
      }
      socket.onclose = () => {
        setConnected(false)
        if (!stopped) retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt++))
      }
    }
    connect()
    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [roomId, roomIds.join('|'), queryClient])

  return { connected, presence }
}
