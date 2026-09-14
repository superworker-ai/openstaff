import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Cog, Mic, PanelRight, Paperclip, Send } from 'lucide-react'
import { MessageMarkdown } from './MessageMarkdown'
import { ConnectAutocomplete } from './ConnectAutocomplete'
import { useConnectedApps } from '../hooks/useConnectedApps'
import { connectRoomApp } from '../lib/connection-popup'
import type { Approval, Bot, ComputerStatus, Message, PublicTurn, User } from '@openstaff/shared'
import type { RoomView } from '../lib/loaders'
import { api, formatTime } from '../lib/api'
import { groupedWithPrevious } from '../lib/message-grouping'
import { BotAvatar, HumanAvatar } from './BotAvatar'
import { ConnectCard } from './ConnectCard'
import { BotCompanion } from './BotCompanion'
import { BotWorkstation } from './BotWorkstation'

interface Props {
  room: RoomView
  user: User
  messages: Message[]
  turns: PublicTurn[]
  approvals: Approval[]
  pending: Record<string, string>
  onSent: (message: Message, turns: PublicTurn[]) => void
  onApproval: (approval: Approval) => void
  onSettings: () => void
  onTogglePanel: () => void
  onShowComputer: () => void
}

function memberBot(room: RoomView, id: string | null): Bot | undefined {
  const entity = room.members.find((member) => member.memberKind === 'bot' && member.memberId === id)?.entity
  return entity && 'job' in entity ? entity : undefined
}

function memberUser(room: RoomView, id: string | null): User | undefined {
  const entity = room.members.find((member) => member.memberKind === 'user' && member.memberId === id)?.entity
  return entity && 'email' in entity ? entity : undefined
}

function HeaderAvatars({ room }: { room: RoomView }) {
  const entities = room.members.slice(0, 3).map((member) => member.entity).filter(Boolean)
  return <div className="relative h-9 shrink-0" style={{ width: 36 + (entities.length - 1) * 9 }}>{entities.map((entity, index) => <div key={entity!.id} className="absolute rounded-full border-2 border-white" style={{ left: index * 9, zIndex: entities.length - index }}>{'job' in entity! ? <BotAvatar {...entity!.avatar} size={32} label={entity!.name} animate /> : <HumanAvatar name={entity!.name} size={32} />}</div>)}</div>
}

export function Thread(props: Props) {
  const { room, user, messages, turns, approvals, pending } = props
  const queryClient = useQueryClient()
  const computerStatus = useQuery({ queryKey: ['computer-status'], queryFn: () => api<ComputerStatus>('/api/computer/status'), refetchInterval: 5000 })
  const apps = useConnectedApps()
  const connect = async (app: string) => { try { setError(''); await connectRoomApp(room.id, app) } catch (error) { setError((error as Error).message) } }
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Message['attachments']>([])
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [stopped, setStopped] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const interactionRoot = useRef<HTMLElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => { pinned.current = true }, [room.id])
  useLayoutEffect(() => {
    if (pinned.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [messages, pending, turns])
  const approvalById = useMemo(() => new Map(approvals.map((approval) => [approval.id, approval])), [approvals])
  const active = turns.filter((turn) => ['running', 'waiting_approval'].includes(turn.status) && !stopped.includes(turn.id))
  const queued = turns.filter((turn, index) => turn.status === 'queued' && !stopped.includes(turn.id) && !active.some((item) => item.botId === turn.botId) && turns.findIndex((item) => item.status === 'queued' && !stopped.includes(item.id) && item.botId === turn.botId) === index)
  const latest = messages.at(-1), companionBot = latest?.authorKind === 'bot' && latest.text.trim() ? memberBot(room, latest.authorId) : undefined
  const showCompanion = Boolean(latest && companionBot && !turns.some((turn) => ['running', 'queued'].includes(turn.status) && !stopped.includes(turn.id)) && !approvals.some((approval) => approval.status === 'pending' && (approval.turnId === latest.turnId || approval.botId === latest.authorId)))
  const roomName = room.name ?? room.members.find((member) => member.memberKind === 'bot')?.entity?.name ?? 'Room'
  const submit = async () => {
    if ((!text.trim() && !attachments.length) || sending || uploading) return
    const content = text.trim()
    setText(''); setSending(true); setError('')
    try {
      if (/^\/connect(?:\s|$)/i.test(content)) { await connectRoomApp(room.id, content.replace(/^\/connect\s*/i, '')); return }
      const result = await api<{ message: Message; turns: PublicTurn[] }>(`/api/rooms/${room.id}/messages`, { method: 'POST', body: JSON.stringify({ text: content, attachments, clientRequestId: crypto.randomUUID() }) })
      props.onSent(result.message, result.turns)
      setAttachments([])
    } catch (reason) { setText(content); setError(reason instanceof Error ? reason.message : 'Send failed') } finally { setSending(false) }
  }
  const upload = async (file: File) => {
    if (file.size > 20 * 1024 ** 2) { setError('File limit is 20 MB'); return }
    setUploading(true); setError('')
    try { const body = new FormData(); body.append('file', file); const result = await api<{ attachment: Message['attachments'][number] }>(`/api/rooms/${room.id}/uploads`, { method: 'POST', body }); setAttachments((current) => [...current, result.attachment]) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Upload failed') } finally { setUploading(false) }
  }
  const stop = async (id: string) => {
    setStopped((current) => [...current, id])
    try { await api(`/api/turns/${id}/cancel`, { method: 'POST' }) } catch { setStopped((current) => current.filter((value) => value !== id)); setError('Could not stop this turn') }
  }
  const takeOver = async () => {
    await api('/api/computer/lease/take', { method: 'POST', body: '{}' })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['computer-status'] }),
      queryClient.invalidateQueries({ queryKey: ['computer-lease'] }),
    ])
    props.onShowComputer()
  }
  let lastDay = ''
  return <section ref={interactionRoot} className="grid min-h-0 grid-rows-[64px_minmax(0,1fr)_auto] bg-white">
    <header className="flex items-center border-b border-zinc-200 px-5"><HeaderAvatars room={room} /><div className="ml-2 min-w-0 flex-1"><h1 className="truncate font-semibold">{roomName}</h1><p className="text-xs text-zinc-400">{room.members.length} members</p></div><button onClick={props.onSettings} aria-label="Room settings" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100"><Cog size={18} /></button><button onClick={props.onTogglePanel} aria-label="Toggle panel" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100"><PanelRight size={18} /></button></header>
    <div ref={scroller} onScroll={(event) => { const el = event.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80 }} className="scrollbar-thin min-h-0 overflow-y-auto px-6 py-6"><div className="mx-auto max-w-3xl">{messages.map((message, index) => {
      const grouped = groupedWithPrevious(messages[index - 1], message)
      const day = new Date(message.createdAt).toDateString()
      const showDay = day !== lastDay
      lastDay = day
      const bot = memberBot(room, message.authorId)
      const human = memberUser(room, message.authorId)
      const mine = message.authorKind === 'user' && message.authorId === user.id
      const approvalId = message.attachments.find((item) => item.subtype === 'approval')?.approvalId
      const approval = typeof approvalId === 'string' ? approvalById.get(approvalId) : undefined
      return <div key={message.id}>{showDay && <div className="my-5 flex items-center gap-3 text-[11px] font-medium text-zinc-400"><span className="h-px flex-1 bg-zinc-100" />{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(message.createdAt))}<span className="h-px flex-1 bg-zinc-100" /></div>}{approval ? <ApprovalCard approval={approval} onUpdate={props.onApproval} desktopAvailable={Boolean(computerStatus.data?.desktop?.stream)} onTakeOver={takeOver} /> : <div className={`group relative ${grouped ? 'mb-1' : 'mb-4'} flex items-end gap-2 ${mine ? 'justify-end' : ''}`}>{!mine && (grouped || (showCompanion && message.id === latest?.id) ? <div className="w-7 shrink-0" /> : bot ? <BotAvatar {...bot.avatar} size={28} /> : human ? <HumanAvatar name={human.name} size={28} /> : <div className="w-7" />)}<div className={`relative max-w-[72%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>{!mine && !grouped && <span className="mb-1 px-1 text-[11px] font-semibold" style={{ color: bot?.avatar.color ?? '#71717a' }}>{bot?.name ?? human?.name ?? 'System'}</span>}<div className={`message-markdown rounded-2xl px-4 py-2.5 ${mine ? 'rounded-br-md bg-black text-white' : message.authorKind === 'system' && !message.attachments.some((item) => item.subtype === 'welcome') ? 'border border-amber-200 bg-amber-50 text-amber-950' : 'rounded-bl-md bg-zinc-100'}`}><MessageMarkdown text={message.text} apps={message.authorKind === 'bot' || message.attachments.some((item) => item.subtype === 'welcome') ? apps.data?.apps ?? [] : []} connect={(app) => void connect(app)} />{message.attachments.filter((item) => item.subtype === 'file').map((file, index) => <span key={index} title={String(file.path)} className="mt-2 flex items-center gap-2 rounded-lg border border-current/15 px-2 py-1 text-xs"><Paperclip size={12} />{String(file.name)} · {Math.ceil(Number(file.size) / 1024)} KB</span>)}</div><time className="pointer-events-none absolute -bottom-3 right-1 z-10 rounded bg-white px-1 text-[10px] text-zinc-400 opacity-0 group-hover:opacity-100">{formatTime(message.createdAt)}</time></div></div>}</div>
    })}{showCompanion && latest && companionBot && <BotCompanion bot={companionBot} message={latest} viewportRef={scroller} interactionRootRef={interactionRoot} />}{active.map((turn) => { const bot = memberBot(room, turn.botId), streamed = pending[turn.id], state = turn.status === 'waiting_approval' ? 'waiting' : 'working'; return <div key={turn.id} className="mb-4 flex items-end gap-1">{bot && <BotWorkstation {...bot.avatar} size={32} state={state} identity={`${bot.id}:${turn.id}`} label={bot.name} />}<div><span className="mb-1 block px-1 text-[11px] font-semibold" style={{ color: bot?.avatar.color }}>{bot?.name}</span><div className="max-w-[72%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-2.5">{streamed || <span className="text-zinc-500">{state === 'waiting' ? 'is waiting for approval' : <>is working<span className="animate-pulse">…</span></>}</span>}{state === 'working' && <button onClick={() => stop(turn.id)} className="ml-3 text-xs text-zinc-500 underline" aria-label={`Stop ${bot?.name ?? 'bot'}`}>Stop</button>}</div></div></div> })}{queued.map((turn) => { const bot = memberBot(room, turn.botId); return <div key={turn.id} className="mb-4 flex items-end gap-2">{bot && <BotAvatar {...bot.avatar} size={28} />}<div><span className="mb-1 block px-1 text-[11px] font-semibold" style={{ color: bot?.avatar.color }}>{bot?.name}</span><div className="max-w-[72%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-2.5"><span className="text-zinc-500">is thinking<span className="animate-pulse">…</span></span><button onClick={() => stop(turn.id)} className="ml-3 text-xs text-zinc-500 underline" aria-label={`Stop ${bot?.name ?? 'bot'}`}>Stop</button></div></div></div> })}<div id="thread-bottom" /></div></div>
    <div className="border-t border-zinc-100 bg-white p-4"><ConnectAutocomplete text={text} apps={apps.data?.apps ?? []} onSelect={(app) => { setText(''); void connect(app) }} />{error && <p role="alert" className="mx-auto mb-2 max-w-3xl text-xs text-red-600">{error}</p>}{attachments.length > 0 && <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">{attachments.map((file, index) => <button key={index} onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))} className="rounded-lg bg-zinc-100 px-2 py-1 text-xs">{String(file.name)} ×</button>)}</div>}<div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-[0_5px_24px_rgba(0,0,0,.07)]"><input ref={fileInput} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '' }} /><button disabled={uploading || attachments.length >= 10} onClick={() => fileInput.current?.click()} aria-label="Attach file" className="rounded-xl p-2 text-zinc-400"><Paperclip size={18} /></button><textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} rows={1} placeholder={`Message ${roomName}`} className="max-h-32 min-h-9 flex-1 resize-none py-2 outline-none" /><button disabled aria-label="Voice input" className="rounded-xl p-2 text-zinc-400"><Mic size={18} /></button><button disabled={(!text.trim() && !attachments.length) || sending || uploading} onClick={submit} aria-label="Send" className="grid h-9 w-9 place-items-center rounded-xl bg-black text-white"><Send size={16} /></button></div></div>
  </section>
}

function ApprovalCard({ approval, onUpdate, desktopAvailable, onTakeOver }: { approval: Approval; onUpdate: (approval: Approval) => void; desktopAvailable: boolean; onTakeOver: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const decide = async (decision: 'approve' | 'deny' | 'human_completed') => {
    setBusy(true); setError('')
    try { const result = await api<{ approval: Approval }>(`/api/approvals/${approval.id}`, { method: 'POST', body: JSON.stringify({ decision }) }); onUpdate(result.approval) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Approval update failed') }
    finally { setBusy(false) }
  }
  const takeOver = async () => { setBusy(true); setError(''); try { await onTakeOver() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Takeover failed') } finally { setBusy(false) } }
  if (approval.kind === 'connect' && approval.connection) return <ConnectCard approval={approval} onUpdate={onUpdate} />
  const browserApproval = approval.toolName.startsWith('browser_') && desktopAvailable
  return <div className="mx-auto mb-5 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Approval requested</p><p className="mt-2 text-sm text-amber-950">{approval.summary}</p><details className="mt-2 text-xs text-amber-800"><summary className="cursor-pointer">Details</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(approval.input, null, 2)}</pre></details>{approval.status === 'pending' ? <div className="mt-4 flex flex-wrap gap-2">{browserApproval && <button disabled={busy} onClick={() => void takeOver()} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm">Take over</button>}{browserApproval && <button disabled={busy} onClick={() => void decide('human_completed')} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm">Done by me</button>}<button disabled={busy} onClick={() => void decide('approve')} className="rounded-lg bg-black px-4 py-2 text-sm text-white">Approve</button><button disabled={busy} onClick={() => void decide('deny')} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm">Not now</button></div> : <p className="mt-3 text-sm font-medium capitalize text-amber-800">{approval.status}</p>}{error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}</div>
}
