import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Bot, Clock, Cpu, KeyRound, Monitor, Plug, Puzzle, SunMoon, type LucideIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import type { User } from '@openstaff/shared'
import { serverApi } from '../lib/server-api'
import { loadMe } from '../lib/loaders'
import { Providers } from '../components/settings/Providers'
import { Models, type WorkspaceSettings } from '../components/settings/Models'
import { Plugins } from '../components/settings/Plugins'
import { Connections } from '../components/settings/Connections'
import { Computer } from '../components/settings/Computer'
import { Bots } from '../components/settings/Bots'
import { Automations } from '../components/settings/Automations'
import { Appearance } from '../components/settings/Appearance'
import { PageFrame } from '../components/PageFrame'

const loadWorkspace = createServerFn({ method: 'GET' }).handler(() => serverApi<{ workspace: WorkspaceSettings }>('/api/workspace'))
const settingsSectionIds = ['providers', 'models', 'appearance', 'plugins', 'connections', 'automations', 'computer', 'bots'] as const
type SettingsSection = typeof settingsSectionIds[number]
type SettingsRenderProps = { workspace: WorkspaceSettings; user: User }
type SettingsEntry = { id: SettingsSection; label: string; icon: LucideIcon; group: 'Workspace' | 'Integrations' | 'Runtime' | 'Team'; render: (props: SettingsRenderProps) => ReactNode }
const settingsSections = [
  { id: 'providers', label: 'Providers', icon: KeyRound, group: 'Workspace', render: ({ user }: SettingsRenderProps) => <Providers owner={user.role === 'owner'} /> },
  { id: 'models', label: 'Models', icon: Cpu, group: 'Workspace', render: ({ workspace }: SettingsRenderProps) => <Models initial={workspace} /> },
  { id: 'appearance', label: 'Appearance', icon: SunMoon, group: 'Workspace', render: () => <Appearance /> },
  { id: 'plugins', label: 'Plugins', icon: Puzzle, group: 'Integrations', render: ({ user }: SettingsRenderProps) => <Plugins owner={user.role === 'owner'} /> },
  { id: 'connections', label: 'Connections', icon: Plug, group: 'Integrations', render: () => <Connections /> },
  { id: 'automations', label: 'Automations', icon: Clock, group: 'Runtime', render: () => <Automations /> },
  { id: 'computer', label: 'Computer', icon: Monitor, group: 'Runtime', render: ({ user }: SettingsRenderProps) => <Computer owner={user.role === 'owner'} /> },
  { id: 'bots', label: 'Bots', icon: Bot, group: 'Team', render: () => <Bots /> },
] as const satisfies readonly SettingsEntry[]
const isSettingsSection = (value: unknown): value is SettingsSection => typeof value === 'string' && settingsSectionIds.some((id) => id === value)
export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): { connected?: string; error?: string; section?: SettingsSection } => ({ connected: typeof search.connected === 'string' ? search.connected : undefined, error: typeof search.error === 'string' ? search.error : undefined, section: isSettingsSection(search.section) ? search.section : undefined }),
  loader: async () => { try { const [settings, me] = await Promise.all([loadWorkspace(), loadMe()]); return { ...settings, user: me.user } } catch { throw redirect({ to: '/login' }) } },
  component: SettingsPage,
})
function SettingsPage() {
  const { workspace, user } = Route.useLoaderData()
  const search = Route.useSearch(), activeSection = search.section ?? (search.connected || search.error ? 'connections' : 'providers'), activeEntry = settingsSections.find((item) => item.id === activeSection)!
  return <PageFrame backLabel="← Back to rooms" backTo="/"><div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)]"><aside className="min-w-0 md:sticky md:top-8 md:self-start"><nav aria-label="Settings sections" className="scrollbar-thin flex gap-1 overflow-x-auto md:block md:overflow-visible">{settingsSections.map((item, index) => { const Icon = item.icon, active = item.id === activeSection, startsGroup = index === 0 || settingsSections[index - 1]!.group !== item.group; return <Fragment key={item.id}>{startsGroup && <h2 className={`${index > 0 ? 'mt-4 ' : ''}mb-1 hidden px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle md:block`}>{item.group}</h2>}<Link to="/settings" search={{ section: item.id }} aria-current={active ? 'page' : undefined} ref={active ? (node) => { node?.scrollIntoView({ inline: 'nearest', block: 'nearest' }) } : undefined} className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm md:mb-1 ${active ? 'bg-surface-3 font-medium text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'}`}><Icon aria-hidden="true" size={16} />{item.label}</Link></Fragment> })}</nav></aside><div className="min-w-0"><h1 className="text-3xl font-semibold">Workspace settings</h1>{search.connected && <p role="status" className="mt-4 rounded-md border border-ok/30 bg-ok/10 p-3 text-sm text-ok">Connected · {search.connected.split('/').slice(1).join('/')}</p>}{search.error && <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{search.error}</p>}<div className="mt-7">{activeEntry.render({ workspace, user })}</div></div></div></PageFrame>
}
