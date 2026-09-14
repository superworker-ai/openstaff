import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectedApp } from '@openstaff/shared'
import { api } from '../lib/api'
import { onConnectionMessage } from '../lib/connection-popup'
import { onConnectionUpdate } from '../lib/connection-events'

export function useConnectionUpdates() {
  const client = useQueryClient()
  useEffect(() => {
    const invalidate = () => { for (const key of ['connection-apps', 'connections', 'plugin-servers', 'marketplace-apps', 'onboarding', 'room-data']) void client.invalidateQueries({ queryKey: [key] }) }
    const offMessage = onConnectionMessage(invalidate), offUpdate = onConnectionUpdate(invalidate)
    return () => { offMessage(); offUpdate() }
  }, [client])
}

export function useConnectedApps() {
  useConnectionUpdates()
  return useQuery({ queryKey: ['connection-apps'], queryFn: () => api<{ configured: boolean; apps: ConnectedApp[] }>('/api/connections/apps'), staleTime: 5000 })
}
