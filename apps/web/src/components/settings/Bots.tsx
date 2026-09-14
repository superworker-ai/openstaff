import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { Bot } from '@openstaff/shared'
import { api } from '../../lib/api'
import { BotAvatar } from '../BotAvatar'
import { Section } from './common'

export type TokenTotals = Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>
export function useUsage() { return useQuery({ queryKey: ['bot-usage'], queryFn: () => api<{ usage: TokenTotals }>('/api/usage'), refetchInterval: 10_000 }) }
export function Bots() {
  const bots = useQuery({ queryKey: ['settings-bots'], queryFn: () => api<{ bots: Bot[] }>('/api/bots') }), usage = useUsage()
  return <Section title="Bots"><div className="space-y-3">{bots.data?.bots.map((bot) => <div key={bot.id} className="flex items-center gap-3"><BotAvatar {...bot.avatar} size={32} label={bot.name} animate /><span className="flex-1">{bot.name}</span><span className="text-xs text-zinc-500">{(usage.data?.usage[bot.id]?.totalTokens ?? 0).toLocaleString()} tokens</span><Link to="/bots/$botId" params={{ botId: bot.id }} aria-label={`Edit ${bot.name}`} className="text-xs font-medium text-zinc-500 underline">Edit</Link></div>)}</div></Section>
}
