import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PluginServerAuth } from '@openstaff/shared'
import { api } from '../lib/api'
import { openConnectionPopup } from '../lib/connection-popup'
import { useConnectionUpdates } from '../hooks/useConnectedApps'
import { buttonClass, ErrorText, inputClass, useAction } from './settings/common'

function ManualClient({ server, onSave, busy }: { server: PluginServerAuth; onSave: (clientId: string, clientSecret: string) => void; busy: boolean }) {
  const [clientId, setClientId] = useState(''), [clientSecret, setClientSecret] = useState(''), [copied, setCopied] = useState(false)
  const google = server.issuer?.includes('accounts.google.com')
  return <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(clientId, clientSecret) }}><p className="text-sm text-zinc-600">Set up a client once. Other apps from this provider will reuse it.</p><ol className="list-inside list-decimal space-y-3 text-sm text-zinc-600"><li>Create an OAuth client (Web application) in the <a className="underline" href={google ? 'https://console.cloud.google.com/apis/credentials' : server.issuer ?? undefined} target="_blank" rel="noreferrer">provider console</a>.</li><li>Enable the API for {server.name} in your project.</li><li>Add exactly this redirect URI:<code className="mt-2 block break-all rounded-lg bg-zinc-100 p-3 text-xs">{server.redirectUri}</code><button type="button" className="mt-2 text-xs underline" onClick={async () => { try { await navigator.clipboard.writeText(server.redirectUri); setCopied(true) } catch { setCopied(false) } }}>{copied ? 'Copied' : 'Copy redirect URI'}</button></li></ol><label className="block text-sm">Client ID<input required autoComplete="off" className={inputClass} value={clientId} onChange={(event) => setClientId(event.target.value)} /></label><label className="block text-sm">Client secret<input type="password" autoComplete="new-password" className={inputClass} value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} /></label><button disabled={busy || !clientId.trim()} className={buttonClass}>Connect {server.name}</button></form>
}

export function ConnectDialog({ pluginId, serverName, approvalId, standalone = false, onClose }: { pluginId: string; serverName?: string; approvalId?: string; standalone?: boolean; onClose?: () => void }) {
  useConnectionUpdates()
  const query = useQuery({ queryKey: ['plugin-servers', pluginId], queryFn: () => api<{ servers: PluginServerAuth[] }>(`/api/plugins/${encodeURIComponent(pluginId)}/servers`), refetchInterval: 2000 })
  const [selected, setSelected] = useState(serverName), [editClient, setEditClient] = useState(false), action = useAction()
  const server = query.data?.servers.find((item) => item.name === selected) ?? query.data?.servers.find((item) => item.protected) ?? query.data?.servers[0]
  useEffect(() => {
    if (!standalone || !server?.connected) return
    if (approvalId && !new URLSearchParams(location.search).has('connected')) { location.replace(`/api/connections/complete?approval=${encodeURIComponent(approvalId)}`); return }
    if (!new URLSearchParams(location.search).has('connected')) return
    if (window.opener) { window.opener.postMessage({ type: 'openstaff:connected', app: server.name, approvalId }, location.origin); window.close() }
  }, [standalone, server?.connected, server?.name, approvalId])
  const connect = (clientId?: string, clientSecret?: string) => {
    let popup: Window | null = null
    void action.run(async () => {
      try {
        if (!standalone) popup = openConnectionPopup()
        const base = `/api/plugins/${encodeURIComponent(pluginId)}/servers/${encodeURIComponent(server!.name)}`
        if (clientId) { await api(`${base}/client`, { method: 'PUT', body: JSON.stringify({ clientId, clientSecret: clientSecret || undefined }) }); setEditClient(false) }
        const result = await api<{ redirectUrl: string }>(`${base}/connect`, { method: 'POST', body: JSON.stringify({ approvalId, reconnect: server!.connected }) })
        await query.refetch()
        if (popup) popup.location.href = result.redirectUrl
        else if (standalone) window.location.href = result.redirectUrl
      } catch (error) { popup?.close(); throw error }
    })
  }
  const content = <div className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-7 shadow-xl"><div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Connect {server?.name ?? 'app'}</h1>{onClose && <button aria-label="Close connection dialog" onClick={onClose} className="p-2 text-zinc-500">×</button>}</div>{query.data && query.data.servers.length > 1 && <select aria-label="App server" className={`${inputClass} mt-4`} value={server?.name} onChange={(event) => setSelected(event.target.value)}>{query.data.servers.map((item) => <option key={item.name}>{item.name}</option>)}</select>}{query.isLoading && <p className="mt-5 text-sm text-zinc-500">Checking connection…</p>}{server && ((server.connected || server.auth === 'none') && !editClient ? <div className="mt-6"><p role="status" className="font-medium text-emerald-700">Connected</p><p className="mt-2 text-sm text-zinc-500">Connected, you can return to the chat.</p><button disabled={action.busy} className="mt-4 text-sm underline" onClick={() => connect()}>Reconnect {server.name}</button>{standalone && <a href="/" className={`${buttonClass} mt-5 inline-block`}>Return to chat</a>}</div> : server.needsClientCredentials || editClient ? <ManualClient server={server} onSave={connect} busy={action.busy} /> : <div className="mt-5"><p className="mb-5 text-sm text-zinc-500">Sign in to {server.name} to give your teammates access. Your conversation will continue when you finish.</p><button disabled={action.busy || server.auth === 'unknown'} className={buttonClass} onClick={() => connect()}>Connect {server.name}</button></div>)}{server?.auth === 'manual-client' && !server.needsClientCredentials && !editClient && <button className="mt-4 block text-xs underline" onClick={() => setEditClient(true)}>Edit OAuth client</button>}<ErrorText error={action.error || query.error?.message || server?.error || undefined} /></div>
  return standalone ? <main className="flex min-h-screen items-center justify-center bg-[#f5f5f3] p-6">{content}</main> : <div role="dialog" aria-modal="true" aria-label="Connect app" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/30 p-6">{content}</div>
}
