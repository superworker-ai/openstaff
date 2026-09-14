import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PluginServerAuth } from '@openstaff/shared'
import { api } from '../../lib/api'
import { ConnectDialog } from '../ConnectDialog'

export function PluginServers({ pluginId, owner }: { pluginId: string; owner: boolean }) {
  const [server, setServer] = useState<string>()
  const query = useQuery({ queryKey: ['plugin-servers', pluginId], queryFn: () => api<{ servers: PluginServerAuth[] }>(`/api/plugins/${encodeURIComponent(pluginId)}/servers`) })
  return <>{query.data?.servers.filter((item) => item.auth !== 'none').map((item) => <button key={item.name} disabled={!owner} onClick={() => setServer(item.name)} className="mr-4 mt-3 text-sm underline">{item.connected ? 'Reconnect' : 'Connect'} {item.name}</button>)}{server && <ConnectDialog pluginId={pluginId} serverName={server} onClose={() => { setServer(undefined); void query.refetch() }} />}</>
}
