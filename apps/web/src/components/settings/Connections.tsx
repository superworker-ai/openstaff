import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { PluginServerAuth } from '@openstaff/shared'
import { openConnectionPopup } from '../../lib/connection-popup'
import { useConnectionUpdates } from '../../hooks/useConnectedApps'
import { api } from '../../lib/api'
import { ConnectDialog } from '../ConnectDialog'
import { dangerButtonClass, ErrorText, secondaryButtonClass, Section, useAction } from './common'

interface ComposioRow { id: string; toolkit: string; status: string; scope: 'member' | 'workspace'; userId: string | null; userName?: string | null }
interface ConnectionList { connections: ComposioRow[]; canManageWorkspace: boolean; servers: Array<PluginServerAuth & { pluginId: string; appName: string }>; clients: Array<{ issuer: string; clientId: string }> }
const statusLabel = (status: string) => status === 'ACTIVE' ? 'Connected' : status === 'EXPIRED' ? 'Expired' : status === 'INITIATED' ? 'Connecting' : 'Error'

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mb-4"><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3><div className="divide-y divide-line">{children}</div></div>
}

function ComposioConnection({ row, manage, action, refetch }: { row: ComposioRow; manage: boolean; action: ReturnType<typeof useAction>; refetch: () => Promise<unknown> }) {
  const managed = row.scope === 'workspace' && !manage
  return <div className="py-3 text-sm">
    <div className="flex justify-between gap-3">
      <span className="capitalize">{row.toolkit} <span className="text-xs text-fg-subtle">{row.userName ?? (row.scope === 'workspace' ? 'Workspace' : 'Composio')}</span></span>
      <span className={row.status === 'ACTIVE' ? 'text-ok' : 'text-waiting'}>{statusLabel(row.status)}</span>
    </div>
    {managed ? <p className="mt-1 text-xs text-fg-subtle">Managed by admins</p> : <div className="mt-2 flex flex-wrap gap-2">
      {!row.userName && <button onClick={() => void action.run(async () => { openConnectionPopup(`/api/connections/start?toolkit=${encodeURIComponent(row.toolkit)}&scope=${row.scope}`) })} className={secondaryButtonClass}>Reconnect</button>}
      <button disabled={action.busy} className={dangerButtonClass} onClick={() => void action.run(async () => { await api(`/api/connections/${row.id}`, { method: 'DELETE' }); await refetch() })}>Disconnect</button>
    </div>}
  </div>
}

export function Connections() {
  useConnectionUpdates()
  const query = useQuery({ queryKey: ['connections'], queryFn: () => api<ConnectionList>('/api/connections'), refetchInterval: 2000 })
  const [selected, setSelected] = useState<{ pluginId: string; name: string }>(), action = useAction()
  const remove = (path: string, body?: unknown) => action.run(async () => { await api(path, { method: 'DELETE', ...(body ? { body: JSON.stringify(body) } : {}) }); await query.refetch() })
  const rows = query.data?.connections ?? [], manage = query.data?.canManageWorkspace ?? false
  const refetch = () => query.refetch()
  const groups: Array<[string, ComposioRow[]]> = [
    ['Your connections', rows.filter((row) => row.scope === 'member' && !row.userName)],
    ['Workspace connections', rows.filter((row) => row.scope === 'workspace')],
    ["Members' connections", rows.filter((row) => row.scope === 'member' && Boolean(row.userName))],
  ]
  return <Section title="Connections">
    {groups.filter(([, items]) => items.length).map(([title, items]) => <Group key={title} title={title}>
      {items.map((row) => <ComposioConnection key={row.id} row={row} manage={manage} action={action} refetch={refetch} />)}
    </Group>)}
    <div className="mb-4 divide-y divide-line">{query.data?.servers.filter((item) => item.auth !== 'none').map((item) => <div key={`${item.pluginId}/${item.name}`} aria-label={`Server ${item.name}`} className="py-3 text-sm"><div className="flex justify-between"><span>{item.appName} <span className="text-xs text-fg-subtle">Plugin</span></span><span className={item.connected ? 'text-ok' : 'text-waiting'}>{item.status}</span></div><p className="mt-1 text-xs text-fg-subtle">Last checked: {item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString() : 'Not checked yet'}</p>{item.refreshError && <p className="mt-1 text-xs text-waiting">{item.refreshError}</p>}<div className="mt-2 flex flex-wrap gap-2"><button className={secondaryButtonClass} onClick={() => setSelected(item)}>{item.connected ? 'Reconnect' : 'Connect'}</button><button disabled={action.busy} className={dangerButtonClass} onClick={() => remove(`/api/plugins/${item.pluginId}/servers/${encodeURIComponent(item.name)}/connection`)}>Disconnect</button></div></div>)}{query.data?.clients.map((item) => <div key={item.issuer} className="py-3 text-sm"><div className="flex justify-between gap-3"><span className="break-all">{item.issuer}<span className="mt-1 block text-xs text-fg-subtle">Shared OAuth client · Configured</span></span><button disabled={action.busy} className={`${dangerButtonClass} shrink-0`} onClick={() => remove('/api/connections/clients', { issuer: item.issuer })}>Forget client</button></div></div>)}</div>
    <Link to="/marketplace" className="text-sm text-fg underline underline-offset-4">Connect an app</Link>
    {selected && <ConnectDialog pluginId={selected.pluginId} serverName={selected.name} onClose={() => { setSelected(undefined); void query.refetch() }} />}
    <ErrorText error={action.error || query.error?.message} />
  </Section>
}
