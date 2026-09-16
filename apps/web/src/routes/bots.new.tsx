import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { MODEL_CATALOG, type Avatar } from '@openstaff/shared'
import { AvatarBuilder } from '../components/AvatarBuilder'
import { BotAvatar } from '../components/BotAvatar'
import { FirstRunChecklist } from '../components/FirstRunChecklist'
import { PageFrame } from '../components/PageFrame'
import { Field } from '../components/ui/field'
import { api } from '../lib/api'
import { loadBotTemplates, loadMe } from '../lib/loaders'
import { MODEL_GROUPS } from '../lib/models'

export const Route = createFileRoute('/bots/new')({
  loader: async () => { try { const [me, templates] = await Promise.all([loadMe(), loadBotTemplates()]); return { ...me, ...templates } } catch { throw redirect({ to: '/login' }) } },
  component: NewBotPage,
})

function NewBotPage() {
  const { templates } = Route.useLoaderData(), navigate = useNavigate(), initial = templates[0]!
  const [selected, setSelected] = useState(initial.id), [name, setName] = useState(''), [job, setJob] = useState(initial.job), [instructions, setInstructions] = useState(initial.instructions), [avatar, setAvatar] = useState<Avatar>(initial.avatar), [model, setModel] = useState(''), [approvalPolicy, setApprovalPolicy] = useState<'auto' | 'writes' | 'all'>('writes'), [error, setError] = useState('')
  const choose = (id: string) => { const value = templates.find((item) => item.id === id) ?? initial; setSelected(id); setJob(value.job); setInstructions(value.instructions); setAvatar(value.avatar) }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try { const response = await api<{ room: { id: string } }>('/api/bots', { method: 'POST', body: JSON.stringify({ templateId: selected, name, job, instructions, avatar, model: model || null, approvalPolicy }) }); await navigate({ to: '/rooms/$roomId', params: { roomId: response.room.id } }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create bot') }
  }
  return <PageFrame backLabel="← Back" onBack={() => history.back()}><div className="mb-9"><p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-fg-subtle">New bot</p><h1 className="text-4xl font-semibold tracking-tight">Meet a future teammate</h1><p className="mt-2 text-fg-muted">Choose a starting point, then make the role your own.</p></div><FirstRunChecklist /><div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-5">{templates.map((item) => <button type="button" key={item.id} onClick={() => choose(item.id)} className={`rounded-lg border p-4 text-left ${selected === item.id ? 'border-line-strong bg-surface-3' : 'border-line bg-surface-2'}`}><BotAvatar {...item.avatar} size={38} label={item.name} /><div className="mt-4 font-medium">{item.name}</div></button>)}</div><form id="create-teammate" onSubmit={submit} className="grid gap-7 rounded-xl border border-line bg-surface-2 p-7 md:grid-cols-[1fr_320px]"><div className="space-y-4"><Field label="Name"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Drake" /></Field><Field label="Job"><input required value={job} onChange={(event) => setJob(event.target.value)} placeholder="One clear line" /></Field><Field label="Instructions"><textarea rows={7} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="How should this teammate work?" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Model"><select value={model} onChange={(event) => setModel(event.target.value)}><option value="">Workspace default</option>{MODEL_GROUPS.map((group) => <optgroup key={group.prefix} label={group.label}>{MODEL_CATALOG.filter((item) => item.id.split('/')[0] === group.prefix).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></Field><Field label="Approval policy"><select value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value as typeof approvalPolicy)}><option value="auto">Automatic</option><option value="writes">Approve writes</option><option value="all">Approve everything</option></select></Field></div>{error && <p className="text-sm text-danger">{error}</p>}<button className="rounded-md bg-accent px-5 py-3 font-medium text-accent-fg hover:opacity-90">Create teammate</button></div><AvatarBuilder value={avatar} onChange={setAvatar} name={name || 'Future teammate'} /></form></PageFrame>
}
