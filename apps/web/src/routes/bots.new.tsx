import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import type { Avatar } from '@openstaff/shared'
import { AvatarBuilder } from '../components/AvatarBuilder'
import { BotAvatar } from '../components/BotAvatar'
import { FirstRunChecklist } from '../components/FirstRunChecklist'
import { ApiError, api } from '../lib/api'
import { loadBotTemplates, loadMe } from '../lib/loaders'
import { usePlan } from '../hooks/usePlan'
import { authRedirect } from '../lib/server-api'

export const Route = createFileRoute('/bots/new')({
  loader: async () => { try { const [me, templates] = await Promise.all([loadMe(), loadBotTemplates()]); return { ...me, ...templates } } catch (reason) { throw redirect({ to: authRedirect(reason) }) } },
  component: NewBotPage,
})

function NewBotPage() {
  const { templates } = Route.useLoaderData(), navigate = useNavigate(), initial = templates[0]!
  const { billingUrl } = usePlan()
  const [selected, setSelected] = useState(initial.id), [name, setName] = useState(''), [job, setJob] = useState(initial.job), [instructions, setInstructions] = useState(initial.instructions), [avatar, setAvatar] = useState<Avatar>(initial.avatar), [model, setModel] = useState(''), [approvalPolicy, setApprovalPolicy] = useState<'auto' | 'writes' | 'all'>('writes'), [error, setError] = useState(''), [errorCode, setErrorCode] = useState<string>()
  const choose = (id: string) => { const value = templates.find((item) => item.id === id) ?? initial; setSelected(id); setJob(value.job); setInstructions(value.instructions); setAvatar(value.avatar) }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrorCode(undefined)
    try { const response = await api<{ room: { id: string } }>('/api/bots', { method: 'POST', body: JSON.stringify({ templateId: selected, name, job, instructions, avatar, model: model || null, approvalPolicy }) }); await navigate({ to: '/rooms/$roomId', params: { roomId: response.room.id } }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create bot'); setErrorCode(reason instanceof ApiError ? reason.code : undefined) }
  }
  return <main className="min-h-screen bg-[#f5f5f3] px-6 py-10"><div className="mx-auto max-w-5xl"><button onClick={() => history.back()} className="mb-8 text-sm text-zinc-500">← Back</button><div className="mb-9"><p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-zinc-400">New bot</p><h1 className="text-4xl font-semibold tracking-tight">Meet a future teammate</h1><p className="mt-2 text-zinc-500">Choose a starting point, then make the role your own.</p></div><FirstRunChecklist /><div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-5">{templates.map((item) => <button key={item.id} onClick={() => choose(item.id)} className={`rounded-2xl border bg-white p-4 text-left ${selected === item.id ? 'border-black' : 'border-zinc-200'}`}><BotAvatar {...item.avatar} size={38} label={item.name} /><div className="mt-4 font-medium">{item.name}</div></button>)}</div><form id="create-teammate" onSubmit={submit} className="grid gap-7 rounded-3xl border border-zinc-200 bg-white p-7 md:grid-cols-[1fr_320px]"><div className="space-y-4"><Field label="Name"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Drake" /></Field><Field label="Job"><input required value={job} onChange={(event) => setJob(event.target.value)} placeholder="One clear line" /></Field><Field label="Instructions"><textarea rows={7} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="How should this teammate work?" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Model"><select value={model} onChange={(event) => setModel(event.target.value)}><option value="">Workspace default</option><option value="xai/grok-4.6">xAI Grok 4.6</option><option value="anthropic/claude-sonnet-5">Claude Sonnet 5</option><option value="openai/gpt-5.6-sol">GPT 5.6 Sol</option></select></Field><Field label="Approval policy"><select value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value as typeof approvalPolicy)}><option value="auto">Automatic</option><option value="writes">Approve writes</option><option value="all">Approve everything</option></select></Field></div>{error && <p className="text-sm text-red-600">{error}{errorCode === 'plan_limit' && billingUrl && <> · <a href={billingUrl} className="font-medium underline underline-offset-2">Upgrade</a></>}</p>}<button className="rounded-xl bg-black px-5 py-3 font-medium text-white">Create teammate</button></div><AvatarBuilder value={avatar} onChange={setAvatar} name={name || 'Future teammate'} /></form></div></main>
}

function Field({ label, children }: { label: string; children: React.ReactElement<{ className?: string }> }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<div className="mt-1 [&>*]:w-full [&>*]:rounded-xl [&>*]:border [&>*]:border-zinc-200 [&>*]:px-3 [&>*]:py-2.5 [&>*]:text-zinc-900 [&>*]:outline-none [&>*]:focus:border-zinc-400">{children}</div></label>
}
