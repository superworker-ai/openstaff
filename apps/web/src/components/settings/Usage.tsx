import { useQuery } from '@tanstack/react-query'
import type { ComputerProviderId, WorkspacePlan } from '@openstaff/shared'
import { api } from '../../lib/api'
import { Section } from './common'

interface UsageSummary {
  month: string
  plan: WorkspacePlan
  includedCreditsUsd: number
  tokens: { byModel: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; turns: number }> }
  computer: { byProvider: Partial<Record<ComputerProviderId, { minutes: number; sessions: number }>> }
}

const number = new Intl.NumberFormat()
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const planName = (value: WorkspacePlan) => value === 'self-hosted' ? 'Self-hosted' : `${value[0]!.toUpperCase()}${value.slice(1)}`

export function Usage() {
  const query = useQuery({ queryKey: ['usage-summary'], queryFn: () => api<UsageSummary>('/api/usage/summary') })
  const usage = query.data
  return <Section title="Usage">{usage && <><div className="mb-6 grid gap-3 sm:grid-cols-3"><Stat label="Month" value={usage.month} /><Stat label="Plan" value={planName(usage.plan)} /><Stat label="Included credits" value={`$${number.format(usage.includedCreditsUsd)}`} /></div><h3 className="mb-2 text-sm font-medium">Tokens by model</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="py-2 font-medium">Model</th><th className="py-2 text-right font-medium">Input</th><th className="py-2 text-right font-medium">Output</th><th className="py-2 text-right font-medium">Total</th><th className="py-2 text-right font-medium">Turns</th></tr></thead><tbody>{Object.entries(usage.tokens.byModel).sort(([a], [b]) => a.localeCompare(b)).map(([model, row]) => <tr key={model} className="border-b border-zinc-100"><td className="py-2.5">{model}</td><td className="py-2.5 text-right">{number.format(row.inputTokens)}</td><td className="py-2.5 text-right">{number.format(row.outputTokens)}</td><td className="py-2.5 text-right">{number.format(row.totalTokens)}</td><td className="py-2.5 text-right">{number.format(row.turns)}</td></tr>)}</tbody></table>{Object.keys(usage.tokens.byModel).length === 0 && <p className="py-4 text-sm text-zinc-500">No completed turns this month.</p>}</div><h3 className="mb-2 mt-7 text-sm font-medium">Computer minutes by provider</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="py-2 font-medium">Provider</th><th className="py-2 text-right font-medium">Minutes</th><th className="py-2 text-right font-medium">Sessions</th></tr></thead><tbody>{Object.entries(usage.computer.byProvider).sort(([a], [b]) => a.localeCompare(b)).map(([provider, row]) => <tr key={provider} className="border-b border-zinc-100"><td className="py-2.5">{provider}</td><td className="py-2.5 text-right">{decimal.format(row.minutes)}</td><td className="py-2.5 text-right">{number.format(row.sessions)}</td></tr>)}</tbody></table>{Object.keys(usage.computer.byProvider).length === 0 && <p className="py-4 text-sm text-zinc-500">No Computer sessions this month.</p>}</div></>}{query.isPending && <p className="text-sm text-zinc-500">Loading usage…</p>}{query.error && <p role="alert" className="text-sm text-red-600">{query.error.message}</p>}</Section>
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-zinc-50 p-3"><div className="text-xs text-zinc-500">{label}</div><div className="mt-1 font-medium">{value}</div></div>
}
