import type { Approval } from '@openstaff/shared'
import { api } from './api'

const popups = new Set<Window>()
export function openConnectionPopup(url = 'about:blank') {
  for (const popup of popups) if (popup.closed) popups.delete(popup)
  // One named window: a second click reuses (and re-focuses) the same Window object, so the set still matches its messages.
  const popup = window.open(url, 'openstaff-connect', 'popup,width=520,height=720')
  if (!popup) throw new Error('Allow popups to connect this app')
  popup.focus()
  popups.add(popup)
  return popup
}

export function onConnectionMessage(callback: (message: { app: string; approvalId?: string }) => void) {
  const listener = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || !popups.has(event.source as Window)) return
    if (event.data?.type !== 'openstaff:connected' || typeof event.data.app !== 'string') return
    callback(event.data)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}

export async function connectRoomApp(roomId: string, app: string) {
  const popup = openConnectionPopup()
  try {
    const result = await api<{ approval: Approval; connectUrl: string }>(`/api/rooms/${roomId}/connect`, { method: 'POST', body: JSON.stringify({ app }) })
    popup.location.href = result.connectUrl
    return result.approval
  } catch (error) { popup.close(); throw error }
}
