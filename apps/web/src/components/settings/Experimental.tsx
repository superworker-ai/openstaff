import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { relativeTime } from '../../lib/time'
import { buttonClass, ErrorText, inputClass, secondaryButtonClass, Section, useAction } from './common'

type JevMode = 'off' | 'shadow'
type JevState = {
  mode: JevMode
  model: string
  timeoutMs: number
  roomIds: string[]
  keyConfigured: boolean
  keySource: 'settings' | 'env' | null
  observations: { count: number; lastAt: string | null }
}
type JevBrowserState = {
  mode: JevMode
  model: string
  timeoutMs: number
  minConfidence: number
  roomIds: string[]
  observations: { count: number; lastAt: string | null }
}
type Draft = { mode: JevMode; model: string; timeoutMs: string; roomIds: string; apiKey: string; clearKey: boolean }
type BrowserDraft = { mode: JevMode; model: string; timeoutMs: string; minConfidence: string; roomIds: string }

const modeOptions: Array<{ value: JevMode; label: string; description: string }> = [
  { value: 'off', label: 'Off', description: 'Off uses only the current reply model.' },
  { value: 'shadow', label: 'Shadow', description: 'Shadow calls Jev in the background for every optional reply and writes a comparison log. No user-visible change.' },
]

const browserModeOptions: Array<{ value: JevMode; label: string; description: string }> = [
  { value: 'off', label: 'Off', description: 'Off leaves browser actions entirely to the current model.' },
  { value: 'shadow', label: 'Shadow', description: 'Shadow asks Jev next to every real browser action and writes a comparison log. No user-visible change.' },
]

function browserDraftOf(state: JevBrowserState): BrowserDraft {
  return { mode: state.mode, model: state.model, timeoutMs: String(state.timeoutMs), minConfidence: String(state.minConfidence), roomIds: state.roomIds.join(', ') }
}

function draftOf(jev: JevState): Draft {
  return { mode: jev.mode, model: jev.model, timeoutMs: String(jev.timeoutMs), roomIds: jev.roomIds.join(', '), apiKey: '', clearKey: false }
}

export function Experimental({ owner }: { owner: boolean }) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['experimental-settings'], queryFn: () => api<{ jev: JevState; jevBrowser: JevBrowserState }>('/api/workspace/experimental') })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState(false)
  const action = useAction()
  const jev = query.data?.jev
  const current = draft ?? (jev ? draftOf(jev) : null)
  const edit = (patch: Partial<Draft>) => { if (current) { setSaved(false); setDraft({ ...current, ...patch }) } }
  const changed = Boolean(jev && current && JSON.stringify(current) !== JSON.stringify(draftOf(jev)))
  const keyAvailable = Boolean((jev?.keyConfigured && !current?.clearKey) || current?.apiKey.trim())
  const save = () => action.run(async () => {
    if (!current) return
    const roomIds = current.roomIds.split(',').map((id) => id.trim()).filter(Boolean)
    const apiKey = current.apiKey.trim() ? current.apiKey.trim() : current.clearKey ? '' : undefined
    await api('/api/workspace/experimental', {
      method: 'PUT',
      body: JSON.stringify({ jev: { mode: current.mode, model: current.model.trim(), timeoutMs: Number(current.timeoutMs), roomIds, ...(apiKey === undefined ? {} : { apiKey }) } }),
    })
    setDraft(null)
    setSaved(true)
    await query.refetch()
    await client.invalidateQueries({ queryKey: ['workspace'] })
  })

  return <div className="space-y-5">
    <p role="note" data-testid="experimental-caution" className="rounded-md border border-line-strong bg-surface-3 p-3 text-sm text-fg-muted">
      Experimental features are unstable and may change or be removed without notice. They can add API cost.
    </p>
    <Section title="Jev reply decisions">
      <p className="mb-5 text-sm text-fg-muted">
        Uses TypeSafe&apos;s Jev model to decide, in about 300 ms, whether a bot should join a group conversation. Shadow mode runs Jev next to the current reply model and logs both answers; it never changes who replies.
      </p>
      {!current ? <p className="text-sm text-fg-muted">{query.isLoading ? 'Loading…' : 'Unavailable.'}</p> : <>
        <div role="radiogroup" aria-label="Jev reply decision mode" className="space-y-2">
          {modeOptions.map((option) => <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={current.mode === option.value}
            data-testid={`jev-mode-${option.value}`}
            disabled={!owner}
            onClick={() => edit({ mode: option.value })}
            className={`block w-full rounded-md border p-3 text-left disabled:opacity-60 ${current.mode === option.value ? 'border-fg bg-surface-3' : 'border-line-strong hover:bg-surface-3'}`}
          >
            <span className="block text-sm font-medium text-fg">{option.label}</span>
            <span className="mt-1 block text-xs text-fg-muted">{option.description}</span>
          </button>)}
        </div>
        {current.mode === 'shadow' && !keyAvailable && <p className="mt-3 text-xs text-danger">Add a TypeSafe API key to enable shadow mode</p>}

        <label className="mt-5 block text-sm font-medium">TypeSafe API key
          {jev?.keyConfigured && !current.clearKey && <span className="ml-2 rounded-full bg-ok/10 px-2 py-1 text-xs text-ok">Configured{jev.keySource === 'env' ? ' from environment' : ''}</span>}
          <div className="flex items-center gap-2">
            <input
              disabled={!owner}
              type="password"
              autoComplete="new-password"
              aria-label="TypeSafe API key"
              placeholder={jev?.keyConfigured && !current.clearKey ? 'Stored secret, enter a new value to replace' : 'API key'}
              value={current.apiKey}
              onChange={(event) => edit({ apiKey: event.target.value, clearKey: false })}
              className={inputClass}
            />
            {owner && <button
              type="button"
              disabled={jev?.keySource === 'env'}
              title={jev?.keySource === 'env' ? 'Set in the server environment' : undefined}
              onClick={() => edit({ apiKey: '', clearKey: true })}
              className={`${secondaryButtonClass} mt-2 shrink-0`}
            >Clear</button>}
          </div>
          {current.clearKey && <span className="text-xs text-fg-muted">Saved key will be cleared. An environment key may still apply.</span>}
        </label>
        <p className="mt-1 text-xs text-fg-subtle">Shared with Jev browser actions.</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">Timeout (ms)
            <input disabled={!owner} type="number" min={100} max={6000} aria-label="Jev timeout in milliseconds" value={current.timeoutMs} onChange={(event) => edit({ timeoutMs: event.target.value })} className={inputClass} />
          </label>
          <label className="block text-sm font-medium">Model
            <input disabled={!owner} type="text" aria-label="Jev model" placeholder="jev-latest" value={current.model} onChange={(event) => edit({ model: event.target.value })} className={inputClass} />
          </label>
        </div>

        <label className="mt-4 block text-sm font-medium">Room IDs
          <textarea disabled={!owner} rows={2} aria-label="Room IDs" value={current.roomIds} onChange={(event) => edit({ roomIds: event.target.value })} className={inputClass} />
          <span className="text-xs text-fg-muted">Comma-separated. Empty means every room.</span>
        </label>

        <p className="mt-5 text-sm text-fg-muted">
          {jev?.observations.count ?? 0} observations logged{jev?.observations.lastAt ? ` · Last ${relativeTime(jev.observations.lastAt)}` : ''}
        </p>
        <p className="mt-1 text-xs text-fg-subtle"><code>data/experiments/jev-replies.jsonl</code></p>

        {owner
          ? <button type="button" disabled={action.busy || !changed} onClick={save} className={`${buttonClass} mt-5`}>{saved && !changed ? 'Saved' : 'Save'}</button>
          : <p className="mt-5 text-sm text-fg-muted">Your workspace owner manages experimental features.</p>}
      </>}
      <ErrorText error={action.error || query.error?.message} />
    </Section>
    <JevBrowserActions owner={owner} state={query.data?.jevBrowser} keyAvailable={keyAvailable} loading={query.isLoading} refresh={async () => { await query.refetch() }} />
  </div>
}

function JevBrowserActions({ owner, state, keyAvailable, loading, refresh }: { owner: boolean; state?: JevBrowserState; keyAvailable: boolean; loading: boolean; refresh: () => Promise<void> }) {
  const [draft, setDraft] = useState<BrowserDraft | null>(null)
  const [saved, setSaved] = useState(false)
  const action = useAction()
  const current = draft ?? (state ? browserDraftOf(state) : null)
  const edit = (patch: Partial<BrowserDraft>) => { if (current) { setSaved(false); setDraft({ ...current, ...patch }) } }
  const changed = Boolean(state && current && JSON.stringify(current) !== JSON.stringify(browserDraftOf(state)))
  const save = () => action.run(async () => {
    if (!current) return
    await api('/api/workspace/experimental', {
      method: 'PUT',
      body: JSON.stringify({ jevBrowser: {
        mode: current.mode, model: current.model.trim(), timeoutMs: Number(current.timeoutMs), minConfidence: Number(current.minConfidence),
        roomIds: current.roomIds.split(',').map((id) => id.trim()).filter(Boolean),
      } }),
    })
    setDraft(null)
    setSaved(true)
    await refresh()
  })

  return <Section title="Jev browser actions">
    <p className="mb-5 text-sm text-fg-muted">
      Uses Jev to pick the next browser action from the controls on the page, in about 300 ms. Shadow mode asks Jev alongside every real click, type, and back action a bot makes and logs whether it agrees; it never changes what the bot does.
    </p>
    {!current ? <p className="text-sm text-fg-muted">{loading ? 'Loading…' : 'Unavailable.'}</p> : <>
      <div role="radiogroup" aria-label="Jev browser action mode" className="space-y-2">
        {browserModeOptions.map((option) => <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={current.mode === option.value}
          data-testid={`jev-browser-mode-${option.value}`}
          disabled={!owner}
          onClick={() => edit({ mode: option.value })}
          className={`block w-full rounded-md border p-3 text-left disabled:opacity-60 ${current.mode === option.value ? 'border-fg bg-surface-3' : 'border-line-strong hover:bg-surface-3'}`}
        >
          <span className="block text-sm font-medium text-fg">{option.label}</span>
          <span className="mt-1 block text-xs text-fg-muted">{option.description}</span>
        </button>)}
      </div>
      {current.mode === 'shadow' && !keyAvailable && <p className="mt-3 text-xs text-danger">Add a TypeSafe API key under Jev reply decisions to enable shadow mode</p>}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Timeout (ms)
          <input disabled={!owner} type="number" min={200} max={6000} aria-label="Jev browser timeout in milliseconds" value={current.timeoutMs} onChange={(event) => edit({ timeoutMs: event.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm font-medium">Model
          <input disabled={!owner} type="text" aria-label="Jev browser model" placeholder="jev-latest" value={current.model} onChange={(event) => edit({ model: event.target.value })} className={inputClass} />
        </label>
      </div>

      <label className="mt-4 block text-sm font-medium">Min confidence
        <input disabled={!owner} type="number" min={0} max={1} step={0.05} aria-label="Jev minimum confidence" value={current.minConfidence} onChange={(event) => edit({ minConfidence: event.target.value })} className={inputClass} />
        <span className="text-xs text-fg-muted">Decisions below this confidence are logged as low confidence.</span>
      </label>

      <label className="mt-4 block text-sm font-medium">Room IDs
        <textarea disabled={!owner} rows={2} aria-label="Browser action room IDs" value={current.roomIds} onChange={(event) => edit({ roomIds: event.target.value })} className={inputClass} />
        <span className="text-xs text-fg-muted">Comma-separated. Empty means every room.</span>
      </label>

      <p className="mt-5 text-sm text-fg-muted">
        {state?.observations.count ?? 0} observations logged{state?.observations.lastAt ? ` · Last ${relativeTime(state.observations.lastAt)}` : ''}
      </p>
      <p className="mt-1 text-xs text-fg-subtle"><code>data/experiments/jev-browser-actions.jsonl</code></p>

      {owner
        ? <button type="button" disabled={action.busy || !changed} onClick={save} className={`${buttonClass} mt-5`}>{saved && !changed ? 'Saved' : 'Save'}</button>
        : <p className="mt-5 text-sm text-fg-muted">Your workspace owner manages experimental features.</p>}
    </>}
    <ErrorText error={action.error} />
  </Section>
}
