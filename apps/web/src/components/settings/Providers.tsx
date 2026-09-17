import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MODEL_PROVIDERS, type ModelProvider } from '@openstaff/shared'
import { api } from '../../lib/api'
import { buttonClass, ErrorText, inputClass, Section, useAction } from './common'
import { usePlan } from '../../hooks/usePlan'
const labels: Record<ModelProvider, string> = { xai: 'xAI', anthropic: 'Anthropic', openai: 'OpenAI', opencode: 'OpenCode (Zen / Go)', composio: 'Composio', aiGateway: 'AI Gateway' }
export function Providers({ owner }: { owner: boolean }) {
  const { managedKeys } = usePlan()
  const query = useQuery({ queryKey: ['provider-keys'], queryFn: () => api<{ configured: Record<ModelProvider, boolean> }>('/api/workspace/provider-keys') })
  const [values, setValues] = useState<Partial<Record<ModelProvider, string>>>({})
  const action = useAction()
  const save = () => action.run(async () => { await api('/api/workspace/provider-keys', { method: 'PUT', body: JSON.stringify(values) }); setValues({}); await query.refetch() })
  if (managedKeys) return <Section title="Providers"><p className="text-sm text-fg-muted">Model and Composio keys are managed by your host.</p></Section>
  return <Section title="Providers"><p className="mb-4 text-sm text-fg-muted">Keys are encrypted and shared by this workspace. Leave a field untouched to keep its key.</p>
    <div className="space-y-4">{MODEL_PROVIDERS.map((provider) => <label key={provider} className="block text-sm font-medium">{labels[provider]}{query.data?.configured[provider] && <span className="ml-2 rounded-full bg-ok/10 px-2 py-1 text-xs text-ok">Configured</span>}
      <div className="flex items-center gap-2"><input disabled={!owner} type="password" autoComplete="new-password" aria-label={`${labels[provider]} API key`} placeholder={query.data?.configured[provider] ? '••••••••' : 'API key'} value={values[provider] ?? ''} onChange={(event) => setValues({ ...values, [provider]: event.target.value })} className={inputClass} />{owner && <button onClick={() => setValues({ ...values, [provider]: '' })} className="mt-2 text-xs text-fg-muted hover:text-fg">Clear</button>}</div>
      {provider === 'opencode' && <span className="text-xs text-fg-muted">One key for <code>opencode/*</code> (Zen, pay per token) and <code>opencode-go/*</code> (Go subscription).</span>}
      {values[provider] === '' && <span className="text-xs text-fg-muted">Saved key will be cleared. An environment key may still apply.</span>}</label>)}</div>
    {owner ? <button disabled={action.busy || !Object.keys(values).length} onClick={save} className={`${buttonClass} mt-5`}>Save keys</button> : <p className="mt-4 text-sm text-fg-muted">Your workspace owner manages provider keys.</p>}<ErrorText error={action.error || query.error?.message} /></Section>
}
