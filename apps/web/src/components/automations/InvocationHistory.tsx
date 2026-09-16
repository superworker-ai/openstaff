import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { AutomationInvocation } from '@openstaff/shared'
import { api } from '../../lib/api'

function relativeTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000), formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}

export function InvocationHistory({ automationId }: { automationId: string }) {
  const queryClient = useQueryClient(), key = ['automation-history', automationId]
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<{ invocations: AutomationInvocation[] }>(`/api/automations/${automationId}/invocations?limit=20${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (page) => page.invocations.length === 20 ? page.invocations.at(-1)?.createdAt : undefined,
    refetchInterval: (state) => state.state.data?.pages.some((page) => page.invocations.some((invocation) => invocation.status === 'running')) ? 10_000 : false,
  })
  const invocations = query.data?.pages.flatMap((page) => page.invocations) ?? []
  const cancel = async (invocationId: string) => { await api(`/api/automations/${automationId}/invocations/${invocationId}/cancel`, { method: 'POST' }); await queryClient.invalidateQueries({ queryKey: key }) }
  return <div className="mt-3 space-y-2 border-l-2 border-line pl-3">{query.isLoading && <p className="text-xs text-fg-subtle">Loading history…</p>}{!query.isLoading && !invocations.length && <p className="text-xs text-fg-subtle">No invocations yet.</p>}{invocations.map((invocation) => <div key={invocation.id} className="rounded-md border border-line bg-surface-3 p-2"><div className="flex items-center justify-between gap-2 text-xs"><span className="capitalize">{invocation.source} · <strong>{invocation.status.replace('_', ' ')}</strong> · {relativeTime(invocation.createdAt)}</span>{invocation.status === 'running' && <button type="button" onClick={() => cancel(invocation.id)} className="rounded-sm border border-danger/50 px-2 py-1 text-danger hover:bg-danger/10">Cancel</button>}</div><div className="mt-1.5 flex flex-wrap gap-1">{invocation.runs.map((run) => <span key={run.id} title={run.error ?? run.skipReason ?? undefined} className="rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 text-[11px]">{run.botName} · {run.status.replace('_', ' ')}</span>)}</div></div>)}{query.hasNextPage && <button type="button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} className="text-xs text-fg-muted hover:text-fg">{query.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}</div>
}
