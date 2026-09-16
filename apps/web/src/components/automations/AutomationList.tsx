import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Automation, InvocationStatus } from '@openstaff/shared'
import type { RoomView } from '../../lib/loaders'
import { api } from '../../lib/api'
import { automationTemplates, type AutomationTemplate } from '../../lib/automation-templates'
import { AutomationForm, type AutomationMutationResult } from './AutomationForm'
import { InvocationHistory } from './InvocationHistory'
import { WebhookKeyPanel } from './WebhookKeyPanel'

export type AutomationView = Automation & { recent: InvocationStatus[] }

const labels: Record<string, string> = { '0 * * * *': 'Hourly', '0 9 * * *': 'Daily 09:00', '0 9 * * 1-5': 'Weekdays 09:00', '0 9 * * 1': 'Weekly Mon 09:00', '0 2 * * *': 'Daily 02:00' }
const dot: Record<InvocationStatus, string> = { running: 'bg-working', completed: 'bg-ok', partial_failed: 'bg-waiting', failed: 'bg-danger', skipped: 'bg-fg-subtle' }

function statusLabel(automation: Automation): string {
  if (automation.enabled && automation.consecutiveFailures > 0) return 'Degraded'
  if (automation.enabled) return 'Active'
  return automation.pausedReason === 'failures' ? 'Paused after failures' : automation.pausedReason === 'missing_member' ? 'Missing member' : automation.pausedReason === 'invalid' ? 'Invalid schedule' : 'Paused'
}

export function AutomationRow({ automation, onChanged, onEdit, onHistory, historyOpen, onWebhookKey }: { automation: AutomationView; onChanged: () => void | Promise<void>; onEdit?: () => void; onHistory?: () => void; historyOpen?: boolean; onWebhookKey?: (value: { url: string; webhookKey: string }) => void }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const act = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); await onChanged() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed') } finally { setBusy(false) } }
  const trigger = automation.trigger === 'webhook' ? 'Webhook' : `${labels[automation.cron ?? ''] ?? automation.cron} · ${automation.timezone}`
  const run = () => act(async () => { await api(`/api/automations/${automation.id}/run`, { method: 'POST' }); await queryClient.invalidateQueries({ queryKey: ['automation-history', automation.id] }) })
  const toggle = () => act(async () => { await api(`/api/automations/${automation.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !automation.enabled }) }) })
  const remove = () => act(async () => { await api(`/api/automations/${automation.id}`, { method: 'DELETE' }) })
  const regenerate = () => act(async () => { const value = await api<{ webhookUrl: string; webhookKey: string }>(`/api/automations/${automation.id}/regenerate-key`, { method: 'POST' }); onWebhookKey?.({ url: value.webhookUrl, webhookKey: value.webhookKey }) })
  const actionClass = 'rounded-sm border border-line-strong px-2 py-1 text-fg hover:bg-surface-3'
  return <article className="border-b border-line py-3 first:pt-0 last:border-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="truncate text-sm font-medium">{automation.name}</h4><span className={`rounded-full px-2 py-0.5 text-[10px] ${automation.enabled ? automation.consecutiveFailures ? 'bg-waiting/10 text-waiting' : 'bg-ok/10 text-ok' : 'bg-surface-3 text-fg-muted'}`}>{statusLabel(automation)}</span></div><p className="mt-1 text-xs text-fg-muted">{trigger}</p>{automation.nextRunAt && <p className="mt-0.5 text-[11px] text-fg-subtle">Next: {new Date(automation.nextRunAt).toLocaleString()}</p>}</div><div className="flex min-w-20 justify-end gap-1" aria-label="Recent invocation statuses">{automation.recent.map((status, index) => <span key={`${status}-${index}`} title={status.replace('_', ' ')} className={`h-2 w-2 rounded-full ${dot[status]}`} />)}</div></div><div className="mt-2 flex flex-wrap gap-2 text-xs"><button disabled={busy} className={actionClass} onClick={run}>Run now</button><button disabled={busy} className={actionClass} onClick={toggle}>{automation.enabled ? 'Pause' : 'Resume'}</button>{onEdit && <button disabled={busy} className={actionClass} onClick={onEdit}>Edit</button>}<button disabled={busy} className="rounded-sm border border-danger/50 px-2 py-1 text-danger hover:bg-danger/10" onClick={remove}>Delete</button>{onHistory && <button disabled={busy} className={actionClass} onClick={onHistory}>History</button>}{automation.trigger === 'webhook' && onWebhookKey && <button disabled={busy} className={actionClass} onClick={regenerate}>Regenerate key</button>}</div>{error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}{historyOpen && <InvocationHistory automationId={automation.id} />}</article>
}

export function AutomationList({ room }: { room: RoomView }) {
  const queryClient = useQueryClient(), key = ['automations', room.id]
  const query = useQuery({ queryKey: key, queryFn: () => api<{ automations: AutomationView[] }>(`/api/automations?roomId=${encodeURIComponent(room.id)}`), refetchInterval: 30_000 })
  const [form, setForm] = useState<{ automation?: Automation; template?: AutomationTemplate } | null>(null)
  const [historyId, setHistoryId] = useState<string>(), [webhook, setWebhook] = useState<{ url: string; webhookKey: string }>()
  const changed = async () => { await queryClient.invalidateQueries({ queryKey: key }) }
  const saved = async (result: AutomationMutationResult) => { setForm(null); await changed(); if (result.webhookKey && result.webhookUrl) setWebhook({ url: result.webhookUrl, webhookKey: result.webhookKey }) }
  return <section className="mt-5 border-t border-line pt-5"><div className="flex items-center justify-between"><h3 className="text-xs font-medium text-fg-muted">Automations</h3><button type="button" onClick={() => { setWebhook(undefined); setForm({}) }} className="text-xs font-medium text-fg hover:text-fg-muted">New automation</button></div><p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Start from a template</p><div className="mt-2 flex flex-wrap gap-1.5">{automationTemplates.map((template) => <button type="button" key={template.id} onClick={() => { setWebhook(undefined); setForm({ template }) }} className="rounded-full border border-line-strong px-2.5 py-1 text-xs text-fg hover:bg-surface-3">{template.title}</button>)}</div>{form && <AutomationForm room={room} automation={form.automation} template={form.template} onSaved={saved} onCancel={() => setForm(null)} />}{webhook && <WebhookKeyPanel url={webhook.url} webhookKey={webhook.webhookKey} onClose={() => setWebhook(undefined)} />}<div className="mt-4">{query.data?.automations.map((automation) => <AutomationRow key={automation.id} automation={automation} onChanged={changed} onEdit={() => { setWebhook(undefined); setForm({ automation }) }} onHistory={() => setHistoryId((current) => current === automation.id ? undefined : automation.id)} historyOpen={historyId === automation.id} onWebhookKey={setWebhook} />)}{query.data?.automations.length === 0 && <p className="text-xs text-fg-subtle">No automations in this room yet.</p>}</div>{query.error && <p role="alert" className="mt-2 text-xs text-danger">{query.error.message}</p>}</section>
}
