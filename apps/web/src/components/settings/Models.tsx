import { useState } from 'react'
import { MODEL_CATALOG } from '@openstaff/shared'
import { api } from '../../lib/api'
import { buttonClass, ErrorText, inputClass, Section, useAction } from './common'
export interface WorkspaceSettings { name: string; defaultModel: string; replyDecisionModel: string | null }
export function Models({ initial }: { initial: WorkspaceSettings }) {
  const [value, setValue] = useState(initial), [saved, setSaved] = useState(false)
  const action = useAction()
  return <Section title="Models"><label className="block text-sm font-medium">Workspace name<input className={inputClass} value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} /></label>
    {(['defaultModel', 'replyDecisionModel'] as const).map((key) => <label key={key} className="mt-4 block text-sm font-medium">{key === 'defaultModel' ? 'Default model' : 'Reply decision model'}<select className={inputClass} value={value[key] ?? ''} onChange={(e) => setValue({ ...value, [key]: e.target.value || null })}>{key === 'replyDecisionModel' && <option value="">Use each bot’s model</option>}{MODEL_CATALOG.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>)}
    <button className={`${buttonClass} mt-5`} disabled={action.busy} onClick={() => action.run(async () => { await api('/api/workspace', { method: 'PATCH', body: JSON.stringify(value) }); setSaved(true) })}>{saved ? 'Saved' : 'Save models'}</button><ErrorText error={action.error} /></Section>
}
