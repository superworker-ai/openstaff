import { useState, type FormEvent } from 'react'
import type { Automation } from '@openstaff/shared'
import type { RoomView } from '../../lib/loaders'
import { ApiError, api } from '../../lib/api'
import type { AutomationTemplate } from '../../lib/automation-templates'
import { buttonClass, ErrorText, inputClass } from '../settings/common'
import { usePlan } from '../../hooks/usePlan'

const cronPresets = [
  { label: 'Hourly', value: '0 * * * *' }, { label: 'Daily 09:00', value: '0 9 * * *' }, { label: 'Weekdays 09:00', value: '0 9 * * 1-5' }, { label: 'Weekly Mon 09:00', value: '0 9 * * 1' },
]

export interface AutomationMutationResult { automation: Automation; webhookKey?: string; webhookUrl?: string }

export function AutomationForm({ room, automation, template, onSaved, onCancel }: { room: RoomView; automation?: Automation; template?: AutomationTemplate; onSaved: (result: AutomationMutationResult) => void; onCancel: () => void }) {
  const { billingUrl } = usePlan()
  const bots = room.members.filter((member) => member.memberKind === 'bot')
  const initialTrigger = automation?.trigger ?? template?.trigger ?? 'schedule'
  const initialCron = automation?.cron ?? template?.cron ?? '0 9 * * *'
  const [name, setName] = useState(automation?.name ?? template?.title ?? '')
  const [trigger, setTrigger] = useState<'schedule' | 'webhook'>(initialTrigger)
  const [cron, setCron] = useState(initialCron)
  const [preset, setPreset] = useState(cronPresets.some((item) => item.value === initialCron) ? initialCron : 'custom')
  const [timezone, setTimezone] = useState(automation?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [targetBotIds, setTargetBotIds] = useState(automation?.targetBotIds ?? (bots[0] ? [bots[0].memberId] : []))
  const [prompt, setPrompt] = useState(automation?.prompt ?? template?.prompt ?? '')
  const [overlap, setOverlap] = useState<'skip' | 'queue'>(automation?.overlap ?? template?.overlap ?? 'skip')
  const [catchUp, setCatchUp] = useState(automation?.catchUp ?? false)
  const [enabled, setEnabled] = useState(automation?.enabled ?? true)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [errorCode, setErrorCode] = useState<string>()
  const toggleBot = (id: string) => setTargetBotIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setErrorCode(undefined)
    try {
      const body = { name, cron: trigger === 'schedule' ? cron : null, timezone, prompt, roomId: room.id, targetBotIds, overlap, catchUp, enabled, ...(!automation ? { trigger } : {}) }
      const result = await api<AutomationMutationResult>(automation ? `/api/automations/${automation.id}` : '/api/automations', { method: automation ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      onSaved(result)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed'); setErrorCode(reason instanceof ApiError ? reason.code : undefined) } finally { setBusy(false) }
  }
  const labelClass = 'block text-xs font-medium text-fg-muted'
  return <form onSubmit={submit} className="mt-3 space-y-3 rounded-md border border-line bg-surface-3 p-4">
    <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">{automation ? 'Edit automation' : 'New automation'}</h4><button type="button" onClick={onCancel} className="text-xs text-fg-muted hover:text-fg">Cancel</button></div>
    <label className={labelClass}>Name<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></label>
    <fieldset><legend className="text-xs font-medium text-fg-muted">Trigger</legend><div className="mt-1 flex gap-4 text-sm"><label className="flex items-center gap-1.5"><input type="radio" checked={trigger === 'schedule'} disabled={Boolean(automation)} onChange={() => { setTrigger('schedule'); if (!cron) setCron('0 9 * * *') }} />Schedule</label><label className="flex items-center gap-1.5"><input type="radio" checked={trigger === 'webhook'} disabled={Boolean(automation)} onChange={() => setTrigger('webhook')} />Webhook</label></div></fieldset>
    {trigger === 'schedule' && <><label className={labelClass}>Schedule<select aria-label="Schedule preset" value={preset} onChange={(event) => { setPreset(event.target.value); if (event.target.value !== 'custom') setCron(event.target.value) }} className={inputClass}>{cronPresets.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}<option value="custom">Custom</option></select></label>{preset === 'custom' && <label className={labelClass}>Cron<input required value={cron} onChange={(event) => setCron(event.target.value)} className={`${inputClass} font-mono`} /></label>}<label className={labelClass}>Timezone<input required value={timezone} onChange={(event) => setTimezone(event.target.value)} className={inputClass} /></label></>}
    <fieldset><legend className="text-xs font-medium text-fg-muted">Bots</legend><div className="mt-1 grid grid-cols-2 gap-2">{bots.map((member) => <label key={member.memberId} className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm"><input type="checkbox" checked={targetBotIds.includes(member.memberId)} onChange={() => toggleBot(member.memberId)} />{member.entity?.name ?? member.memberId}</label>)}</div><p className="mt-1 text-[11px] text-fg-subtle">Choose 1 to 5 bots.</p></fieldset>
    <label className={labelClass}>Instructions<textarea required maxLength={20_000} rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} className={inputClass} /></label>
    <label className={labelClass}>Overlap<select value={overlap} onChange={(event) => setOverlap(event.target.value as 'skip' | 'queue')} className={inputClass}><option value="skip">Skip when busy</option><option value="queue">Queue behind current work</option></select></label>
    {trigger === 'schedule' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={catchUp} onChange={(event) => setCatchUp(event.target.checked)} />Catch up a missed run after a restart</label>}
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Enabled</label>
    <button disabled={busy || targetBotIds.length < 1 || targetBotIds.length > 5} className={`${buttonClass} w-full`}>{busy ? 'Saving…' : 'Save automation'}</button><ErrorText error={error} />{errorCode === 'plan_limit' && billingUrl && <a href={billingUrl} className="inline-block text-xs font-medium underline underline-offset-2">Upgrade</a>}
  </form>
}
