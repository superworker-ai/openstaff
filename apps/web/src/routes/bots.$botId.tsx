import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { MODEL_CATALOG, type Avatar, type Bot } from '@openstaff/shared'
import { AvatarBuilder } from '../components/AvatarBuilder'
import { PageFrame } from '../components/PageFrame'
import { Field } from '../components/ui/field'
import { api } from '../lib/api'
import { loadBot, type RoomData, type RoomView } from '../lib/loaders'
import { MODEL_GROUPS } from '../lib/models'

export const Route = createFileRoute('/bots/$botId')({
  loader: async ({ params }) => { try { return await loadBot({ data: { botId: params.botId } }) } catch { throw redirect({ to: '/login' }) } },
  component: EditBotPage,
})

function EditBotPage() {
  const { bot } = Route.useLoaderData(), navigate = useNavigate(), queryClient = useQueryClient()
  const [name, setName] = useState(bot.name), [job, setJob] = useState(bot.job), [instructions, setInstructions] = useState(bot.instructions), [avatar, setAvatar] = useState<Avatar>(bot.avatar), [model, setModel] = useState(bot.model ?? ''), [approvalPolicy, setApprovalPolicy] = useState<Bot['approvalPolicy']>(bot.approvalPolicy), [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    try {
      const { bot: updated } = await api<{ bot: Bot }>(`/api/bots/${bot.id}`, { method: 'PATCH', body: JSON.stringify({ name, job, instructions, avatar, model: model || null, approvalPolicy }) })
      queryClient.setQueriesData<RoomData>({ queryKey: ['room-data'] }, (current) => {
        if (!current) return current
        const refresh = (room: RoomView): RoomView => ({ ...room, members: room.members.map((member) => member.memberKind === 'bot' && member.memberId === updated.id ? { ...member, entity: updated } : member) })
        return { ...current, bots: current.bots.map((item) => item.id === updated.id ? updated : item), room: refresh(current.room), rooms: current.rooms.map(refresh) }
      })
      const { rooms } = await api<{ rooms: RoomView[] }>('/api/rooms'), room = rooms.find((item) => item.kind === 'dm' && item.members.some((member) => member.memberKind === 'bot' && member.memberId === bot.id))
      if (room) await navigate({ to: '/rooms/$roomId', params: { roomId: room.id } }); else history.back()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save bot') }
  }
  return <PageFrame backLabel="← Back" onBack={() => history.back()}><div className="mb-9"><p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-fg-subtle">Bot settings</p><h1 className="text-4xl font-semibold tracking-tight">Edit teammate</h1></div><form onSubmit={submit} className="grid gap-7 rounded-xl border border-line bg-surface-2 p-7 md:grid-cols-[1fr_320px]"><div className="space-y-4"><Field label="Name"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Job"><input required value={job} onChange={(event) => setJob(event.target.value)} /></Field><Field label="Instructions"><textarea rows={7} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Model"><select value={model} onChange={(event) => setModel(event.target.value)}><option value="">Workspace default</option>{MODEL_GROUPS.map((group) => <optgroup key={group.prefix} label={group.label}>{MODEL_CATALOG.filter((item) => item.id.split('/')[0] === group.prefix).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></Field><Field label="Approval policy"><select value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value as Bot['approvalPolicy'])}><option value="auto">Automatic</option><option value="writes">Approve writes</option><option value="all">Approve everything</option></select></Field></div>{error && <p role="alert" className="text-sm text-danger">{error}</p>}<button className="rounded-md bg-accent px-5 py-3 font-medium text-accent-fg hover:opacity-90">Save changes</button></div><AvatarBuilder value={avatar} onChange={setAvatar} name={name} /></form></PageFrame>
}
