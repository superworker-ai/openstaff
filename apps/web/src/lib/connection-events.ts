const listeners = new Set<(message: { app: string }) => void>()
let socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined

function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`)
  socket.onmessage = (event) => {
    try { const message = JSON.parse(event.data); if (message.type === 'connection.updated' && typeof message.app === 'string') for (const listener of listeners) listener(message) } catch { /* Ignore unrelated or malformed events. */ }
  }
  socket.onclose = () => { if (listeners.size) retry = setTimeout(connect, 3000) }
}

export function onConnectionUpdate(listener: (message: { app: string }) => void) {
  listeners.add(listener)
  if (!socket) connect()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { if (retry) clearTimeout(retry); if (socket) socket.onclose = null; socket?.close(); socket = undefined }
  }
}
