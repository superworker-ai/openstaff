import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Bot, ChartBar, Clock, Cpu, KeyRound, Monitor, Plug, Puzzle, ShieldCheck, UserRoundCog, type LucideIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import type { User } from '@openstaff/shared'
import { authRedirect, serverApi } from '../lib/server-api'
import { loadMe } from '../lib/loaders'
import { Providers } from '../components/settings/Providers'
import { Models, type WorkspaceSettings } from '../components/settings/Models'
import { Plugins } from '../components/settings/Plugins'
import { Connections } from '../components/settings/Connections'
import { Computer } from '../components/settings/Computer'
import { Bots } from '../components/settings/Bots'
import { Automations } from '../components/settings/Automations'
import { Usage } from '../components/settings/Usage'
import { Members } from '../components/settings/Members'
import { Security } from '../components/settings/Security'

const loadWorkspace = createServerFn({ method: 'GET' }).handler(() => serverApi<{ workspace: WorkspaceSettings }>('/api/workspace'))
const settingsSectionIds = ['providers', 'models', 'security', 'usage', 'plugins', 'connections', 'automations', 'computer', 'members', 'bots'] as const
type SettingsSection = typeof settingsSectionIds[number]
type SettingsRenderProps = { workspace: WorkspaceSettings; user: User }
type SettingsEntry = { id: SettingsSection; label: string; icon: LucideIcon; group: 'Workspace' | 'Integrations' | 'Runtime' | 'Team'; ownerOnly?: boolean; administratorOnly?: boolean; render: (props: SettingsRenderProps) => ReactNode }
const settingsSections: readonly SettingsEntry[] = [
  { id: 'providers', label: 'Providers', icon: KeyRound, group: 'Workspace', render: ({ user }: SettingsRenderProps) => <Providers owner={user.role === 'owner'} /> },
  { id: 'models', label: 'Models', icon: Cpu, group: 'Workspace', render: ({ workspace }: SettingsRenderProps) => <Models initial={workspace} /> },
  { id: 'security', label: 'Security', icon: ShieldCheck, group: 'Workspace', administratorOnly: true, render: ({ user }: SettingsRenderProps) => <Security user={user} /> },
  { id: 'usage', label: 'Usage', icon: ChartBar, group: 'Workspace', ownerOnly: true, render: () => <Usage /> },
  { id: 'plugins', label: 'Plugins', icon: Puzzle, group: 'Integrations', render: ({ user }: SettingsRenderProps) => <Plugins owner={user.role === 'owner'} /> },
  { id: 'connections', label: 'Connections', icon: Plug, group: 'Integrations', render: () => <Connections /> },
  { id: 'automations', label: 'Automations', icon: Clock, group: 'Runtime', render: () => <Automations /> },
  { id: 'computer', label: 'Computer', icon: Monitor, group: 'Runtime', render: ({ user }: SettingsRenderProps) => <Computer owner={user.role === 'owner'} /> },
  { id: 'members', label: 'Members', icon: UserRoundCog, group: 'Team', administratorOnly: true, render: ({ user }: SettingsRenderProps) => <Members currentUser={user} /> },
  { id: 'bots', label: 'Bots', icon: Bot, group: 'Team', render: () => <Bots /> },
]
const isSettingsSection = (value: unknown): value is SettingsSection => typeof value === 'string' && settingsSectionIds.some((id) => id === value)
export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): { connected?: string; error?: string; section?: SettingsSection } => ({ connected: typeof search.connected === 'string' ? search.connected : undefined, error: typeof search.error === 'string' ? search.error : undefined, section: isSettingsSection(search.section) ? search.section : undefined }),
  loader: async () => { try { const [settings, me] = await Promise.all([loadWorkspace(), loadMe()]); return { ...settings, user: me.user } } catch (reason) { throw redirect({ to: authRedirect(reason) }) } },
  component: SettingsPage,
})
function SettingsPage() {
  const { workspace, user } = Route.useLoaderData()
  const search = Route.useSearch(), visibleSections = settingsSections.filter((item) => (!item.ownerOnly || user.role === 'owner') && (!item.administratorOnly || user.role === 'owner' || user.role === 'admin')), requestedSection = search.section ?? (search.connected || search.error ? 'connections' : 'providers'), activeEntry = visibleSections.find((item) => item.id === requestedSection) ?? visibleSections[0]!
  return <main className="min-h-screen bg-[#f5f5f3]"><div className="mx-auto grid max-w-5xl gap-8 px-6 py-8 md:grid-cols-[220px_minmax(0,1fr)]"><aside className="min-w-0 md:sticky md:top-8 md:self-start"><Link to="/" className="text-sm text-zinc-500">← Back to rooms</Link><nav aria-label="Settings sections" className="scrollbar-thin mt-6 flex gap-1 overflow-x-auto md:block md:overflow-visible">{visibleSections.map((item, index) => { const Icon = item.icon, active = item.id === activeEntry.id, startsGroup = index === 0 || visibleSections[index - 1]!.group !== item.group; return <Fragment key={item.id}>{startsGroup && <h2 className={`${index > 0 ? 'mt-4 ' : ''}mb-1 hidden px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 md:block`}>{item.group}</h2>}<Link to="/settings" search={{ section: item.id }} aria-current={active ? 'page' : undefined} ref={active ? (node) => { node?.scrollIntoView({ inline: 'nearest', block: 'nearest' }) } : undefined} className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm md:mb-1 ${active ? 'bg-white font-medium text-zinc-900 shadow-sm' : 'text-zinc-600 hover:bg-white/70'}`}><Icon aria-hidden="true" size={16} />{item.label}</Link></Fragment> })}</nav></aside><div className="min-w-0"><h1 className="text-3xl font-semibold">Workspace settings</h1>{search.connected && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Connected · {search.connected.split('/').slice(1).join('/')}</p>}{search.error && <p role="alert" className="mt-4 text-sm text-red-600">{search.error}</p>}<div className="mt-7">{activeEntry.render({ workspace, user })}</div></div></div></main>
}
