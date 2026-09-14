import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { PluginManifest } from '@openstaff/shared'
import { api } from '../../lib/api'
import { buttonClass, ErrorText, Section, useAction } from './common'
import { PluginServers } from './PluginServers'
import { VariableInput } from './VariableInput'
export interface InstalledPlugin { id: string; name: string; manifest: PluginManifest; enabled: boolean; variablesConfigured: Record<string, boolean>; skills: Array<{ name: string }>; hooks: { supported: false } | null }
function PluginRow({ plugin, owner, refresh }: { plugin: InstalledPlugin; owner: boolean; refresh: () => Promise<unknown> }) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const action = useAction()
  const update = (changes: unknown) => action.run(async () => { await api(`/api/plugins/${plugin.id}`, { method: 'PATCH', body: JSON.stringify(changes) }); setValues({}); await refresh() })
  const saveVariables = () => action.run(async () => {
    const variables = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, ['object', 'array'].includes(plugin.manifest.variables?.properties?.[name]?.type ?? '') ? JSON.parse(String(value)) : value]))
    await api(`/api/plugins/${plugin.id}`, { method: 'PATCH', body: JSON.stringify({ variables }) }); setValues({}); await refresh()
  })
  return <article className="border-t border-zinc-100 py-5 first:border-0 first:pt-0"><div className="flex items-start gap-3">{plugin.manifest.logo && <img src={plugin.manifest.logo} alt="" className="h-9 w-9 rounded-lg object-contain" />}<div className="flex-1"><h3 className="font-medium">{plugin.manifest.displayName ?? plugin.name}</h3><p className="mt-1 text-sm text-zinc-500">{plugin.manifest.description}</p><p className="mt-2 text-xs text-zinc-400">{plugin.skills.length} skills{plugin.hooks ? ' · Hooks are unsupported' : ''}</p></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!owner || action.busy} checked={plugin.enabled} onChange={(e) => update({ enabled: e.target.checked })} />Enabled</label></div>
    <PluginServers pluginId={plugin.id} owner={owner} />
    {owner && <><div className="mt-4 space-y-3">{Object.entries(plugin.manifest.variables?.properties ?? {}).map(([name, field]) => <label key={name} className="block text-xs font-medium">{field.title ?? name}{plugin.variablesConfigured[name] && <span className="ml-2 text-emerald-700">Configured</span>}<VariableInput field={field} value={values[name]} configured={Boolean(plugin.variablesConfigured[name])} onChange={(value) => setValues({ ...values, [name]: value })} /><span className="mt-1 block font-normal text-zinc-400">{field.description}</span></label>)}</div><div className="mt-4 flex items-center gap-4">{Object.keys(plugin.manifest.variables?.properties ?? {}).length > 0 && <button disabled={action.busy || !Object.keys(values).length} className={buttonClass} onClick={saveVariables}>Save variables</button>}<button disabled={action.busy} className="text-xs text-red-600" onClick={() => action.run(async () => { await api(`/api/plugins/${plugin.id}`, { method: 'DELETE' }); await refresh() })}>Delete plugin</button></div></>}<ErrorText error={action.error} /></article>
}
export function Plugins({ owner }: { owner: boolean }) {
  const query = useQuery({ queryKey: ['plugins'], queryFn: () => api<{ plugins: InstalledPlugin[] }>('/api/plugins') })
  return <Section title="Plugins">{query.data?.plugins.map((plugin) => <PluginRow key={plugin.id} plugin={plugin} owner={owner} refresh={query.refetch} />)}{query.data?.plugins.length === 0 && <p className="mb-3 text-sm text-zinc-500">No plugins installed yet.</p>}<Link to="/marketplace" className="text-sm underline underline-offset-4">Browse plugins</Link><ErrorText error={query.error?.message} /></Section>
}
