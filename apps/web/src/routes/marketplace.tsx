import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import type { MarketplaceAppsPage, MarketplaceSkillsPage, PluginServerAuth } from '@openstaff/shared'
import { api } from '../lib/api'
import { loadMe } from '../lib/loaders'
import { ConnectDialog } from '../components/ConnectDialog'
import { ErrorText, inputClass, useAction } from '../components/settings/common'
import { MarketplaceGrid } from '../components/marketplace/Grid'
import { AppCard, SkillCard } from '../components/marketplace/Cards'
import { useDebouncedSearch, useMarketplace, useMarketplaceUpdates } from '../hooks/useMarketplace'
import { useConnectionUpdates } from '../hooks/useConnectedApps'
import { PageFrame } from '../components/PageFrame'

export const Route = createFileRoute('/marketplace')({ loader: async () => { try { return await loadMe() } catch { throw redirect({ to: '/login' }) } }, component: MarketplacePage })

function MarketplacePage() {
  useConnectionUpdates()
  const { user } = Route.useLoaderData()
  const [tab, setTab] = useState<'apps' | 'skills'>('apps'), [search, setSearch] = useState('')
  const [connectPlugin, setConnectPlugin] = useState<{ id: string; slug?: string }>()
  const q = useDebouncedSearch(search), action = useAction(), updates = useMarketplaceUpdates()
  const appsQuery = useMarketplace<MarketplaceAppsPage>('apps', q, tab === 'apps')
  const skillsQuery = useMarketplace<MarketplaceSkillsPage>('skills', q, tab === 'skills')
  const query = tab === 'apps' ? appsQuery : skillsQuery
  const apps = [...new Map(appsQuery.data?.pages.flatMap((page) => page.apps).map((item) => [item.slug, item])).values()]
  const skills = [...new Map(skillsQuery.data?.pages.flatMap((page) => page.skills).map((item) => [item.name, item])).values()]
  const info = query.data?.pages.at(-1)
  const install = (name: string, slug?: string) => action.run(async () => {
    const result = await api<{ plugin: { id: string }; servers: PluginServerAuth[] }>('/api/plugins/install', { method: 'POST', body: JSON.stringify({ source: `marketplace:${name}` }) })
    if (result.servers.some((server) => server.auth !== 'none' && !server.connected)) setConnectPlugin({ id: result.plugin.id, slug })
    if (slug) await updates.refreshApp(slug)
    else updates.installedSkill(name)
  })
  return <PageFrame backLabel="← Back to rooms" backTo="/" actions={<Link to="/settings" className="rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-3 hover:text-fg">Settings</Link>}>
    <h1 className="text-3xl font-semibold">Marketplace</h1><p className="mt-2 text-fg-muted">Connect your apps. Give your teammates new skills.</p>
    <div role="tablist" aria-label="Marketplace categories" className="mt-7 flex gap-5 border-b border-line">
      {(['apps', 'skills'] as const).map((value) => <button role="tab" aria-selected={tab === value} data-testid={`marketplace-tab-${value}`} key={value} onClick={() => setTab(value)} className={`border-b-2 pb-3 text-sm capitalize ${tab === value ? 'border-fg font-semibold text-fg' : 'border-transparent text-fg-muted'}`}>{value === 'apps' ? 'Apps' : 'Skills'}</button>)}
    </div>
    <input aria-label="Search marketplace" placeholder={`Search ${tab}`} className={`${inputClass} mt-5 max-w-sm`} value={search} onChange={(event) => setSearch(event.target.value)} />
    <ErrorText error={action.error || query.error?.message} />
    <MarketplaceGrid loading={query.isPending} count={tab === 'apps' ? apps.length : skills.length} total={info?.total ?? 0} warming={info?.warming ?? false} q={q} more={query.hasNextPage} fetching={query.isFetching} loadMore={() => { if (!query.isFetching) void query.fetchNextPage() }}>
      {tab === 'apps' ? apps.map((item) => <AppCard key={item.slug} item={item} configured={info?.configured ?? false} onConfigured={updates.configured} disabled={action.busy || user.role !== 'owner'} onPlugin={(name, id) => id ? setConnectPlugin({ id, slug: item.slug }) : void install(name, item.slug)} />) : skills.map((item) => <SkillCard key={item.name} item={item} disabled={action.busy || user.role !== 'owner'} install={() => { void install(item.name) }} />)}
    </MarketplaceGrid>
    {connectPlugin && <ConnectDialog pluginId={connectPlugin.id} onClose={() => { const slug = connectPlugin.slug; setConnectPlugin(undefined); if (slug) void action.run(() => updates.refreshApp(slug)) }} />}
  </PageFrame>
}
