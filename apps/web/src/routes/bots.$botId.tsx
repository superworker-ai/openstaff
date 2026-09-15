import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { Avatar, Bot } from '@openstaff/shared'
import { AvatarBuilder } from '../components/AvatarBuilder'
import { api } from '../lib/api'
import { loadBot, type RoomData, type RoomView } from '../lib/loaders'
import { authRedirect } from '../lib/server-api'

export const Route = createFileRoute('/bots/$botId')({
  loader: async ({ params }) => { try { return await loadBot({ data: { botId: params.botId } }) } catch (reason) { throw redirect({ to: authRedirect(reason) }) } },
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
  return <main className="min-h-screen bg-[#f5f5f3] px-6 py-10"><div className="mx-auto max-w-5xl"><button onClick={() => history.back()} className="mb-8 text-sm text-zinc-500">← Back</button><div className="mb-9"><p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-zinc-400">Bot settings</p><h1 className="text-4xl font-semibold tracking-tight">Edit teammate</h1></div><form onSubmit={submit} className="grid gap-7 rounded-3xl border border-zinc-200 bg-white p-7 md:grid-cols-[1fr_320px]"><div className="space-y-4"><Field label="Name"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Job"><input required value={job} onChange={(event) => setJob(event.target.value)} /></Field><Field label="Instructions"><textarea rows={7} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Model"><select value={model} onChange={(event) => setModel(event.target.value)}><option value="">Workspace default</option><option value="xai/grok-4.6">xAI Grok 4.6</option><option value="anthropic/claude-sonnet-5">Claude Sonnet 5</option><option value="openai/gpt-5.6-sol">GPT 5.6 Sol</option></select></Field><Field label="Approval policy"><select value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value as Bot['approvalPolicy'])}><option value="auto">Automatic</option><option value="writes">Approve writes</option><option value="all">Approve everything</option></select></Field></div>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}<button className="rounded-xl bg-black px-5 py-3 font-medium text-white">Save changes</button></div><AvatarBuilder value={avatar} onChange={setAvatar} name={name} /></form></div></main>
}

function Field({ label, children }: { label: string; children: React.ReactElement<{ className?: string }> }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<div className="mt-1 [&>*]:w-full [&>*]:rounded-xl [&>*]:border [&>*]:border-zinc-200 [&>*]:px-3 [&>*]:py-2.5 [&>*]:text-zinc-900 [&>*]:outline-none [&>*]:focus:border-zinc-400">{children}</div></label>
}
