import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, ChevronDown, Monitor, MoreHorizontal, Paperclip, Plus, Square } from 'lucide-react'
import { MODEL_CATALOG, type Approval, type Bot, type ComputerStatus, type Message, type PublicTurn, type User } from '@openstaff/shared'
import { MessageMarkdown } from './MessageMarkdown'
import { ConnectAutocomplete } from './ConnectAutocomplete'
import { useConnectedApps } from '../hooks/useConnectedApps'
import { connectRoomApp } from '../lib/connection-popup'
import type { RoomData, RoomView } from '../lib/loaders'
import { api, formatTime } from '../lib/api'
import { groupedWithPrevious } from '../lib/message-grouping'
import { MODEL_GROUPS } from '../lib/models'
import { normalizeSectionName } from '../lib/room-sections'
import { BotAvatar, HumanAvatar } from './BotAvatar'
import { ConnectCard } from './ConnectCard'
import { BotCompanion } from './BotCompanion'
import { BotWorkstation } from './BotWorkstation'
import { MembersPopover } from './MembersPopover'
import { RoomApps } from './RoomApps'
import { SectionPicker, SectionTriggerLabel, useRoomSections } from './RoomSections'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { IconButton } from './ui/icon-button'

interface Props {
  room: RoomView
  user: User
  bots: Bot[]
  users: User[]
  presence: Array<{ id: string; name: string }>
  messages: Message[]
  turns: PublicTurn[]
  approvals: Approval[]
  pending: Record<string, string>
  computerOpen: boolean
  membersOpen: boolean
  onMembersOpenChange: (open: boolean) => void
  onOpenMembers: () => void
  onMembersChanged: () => void
  onSent: (message: Message, turns: PublicTurn[]) => void
  onApproval: (approval: Approval) => void
  onSettings: () => void
  onToggleComputer: () => void
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

function botLabelStyle(color?: string) {
  return color ? { color: `color-mix(in oklab, ${color} var(--label-mix), var(--color-fg))` } : undefined
}

function HeaderAvatars({ room }: { room: RoomView }) {
  const entities = room.members.slice(0, 3).map((member) => member.entity).filter(Boolean)
  return <div className="relative h-9 shrink-0" style={{ width: 36 + Math.max(0, entities.length - 1) * 9 }}>{entities.map((entity, index) => <div key={entity!.id} className="absolute rounded-full border-2 border-surface" style={{ left: index * 9, zIndex: entities.length - index }}>{'job' in entity! ? <BotAvatar {...entity!.avatar} size={32} label={entity!.name} animate /> : <HumanAvatar name={entity!.name} size={32} />}</div>)}</div>
}

function ModelPicker({ bot, roomId, onError }: { bot: Bot; roomId: string; onError: (error: string) => void }) {
  const queryClient = useQueryClient()
  const workspace = useQuery({ queryKey: ['workspace'], queryFn: () => api<{ workspace: { defaultModel: string } }>('/api/workspace') })
  const [busy, setBusy] = useState(false)
  const defaultModel = workspace.data?.workspace.defaultModel
  const defaultName = MODEL_CATALOG.find((item) => item.id === defaultModel)?.name ?? defaultModel ?? 'Default'
  const currentName = bot.model ? MODEL_CATALOG.find((item) => item.id === bot.model)?.name ?? bot.model : `Default · ${defaultName}`
  const select = async (value: string) => {
    setBusy(true); onError('')
    try {
      const { bot: updated } = await api<{ bot: Bot }>(`/api/bots/${bot.id}`, { method: 'PATCH', body: JSON.stringify({ model: value || null }) })
      queryClient.setQueryData<RoomData>(['room-data', roomId], (current) => {
        if (!current) return current
        const refresh = (room: RoomView): RoomView => ({ ...room, members: room.members.map((member) => member.memberKind === 'bot' && member.memberId === updated.id ? { ...member, entity: updated } : member) })
        return { ...current, bots: current.bots.map((item) => item.id === updated.id ? updated : item), room: refresh(current.room), rooms: current.rooms.map(refresh) }
      })
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Could not change model') }
    finally { setBusy(false) }
  }
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" disabled={busy} aria-label="Model" className="flex h-8 min-w-0 max-w-56 items-center gap-1.5 truncate rounded-md px-2 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg max-[639px]:max-w-[112px]"><span className="truncate">{currentName}</span><ChevronDown size={13} className="shrink-0" /></button></DropdownMenuTrigger>
    <DropdownMenuContent label="Model" align="end" side="top" className="max-h-[min(440px,60vh)] w-72 overflow-y-auto">
      <DropdownMenuRadioGroup value={bot.model ?? ''} onValueChange={(value) => void select(value)}>
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <DropdownMenuRadioItem value="">Default · {defaultName}</DropdownMenuRadioItem>
        <DropdownMenuSeparator />
        {MODEL_GROUPS.map((group, index) => <div key={group.prefix}>
          {index > 0 && <DropdownMenuSeparator />}
          <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
          {MODEL_CATALOG.filter((model) => model.id.split('/')[0] === group.prefix).map((model) => <DropdownMenuRadioItem key={model.id} value={model.id}>{model.name}</DropdownMenuRadioItem>)}
        </div>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}

export function Thread(props: Props) {
  const { room, user, bots, users, presence, messages, turns, approvals, pending } = props
  const { rooms: shellRooms } = useRoomSections()
  const assignedSection = normalizeSectionName(shellRooms.find((item) => item.id === room.id)?.section)
  const queryClient = useQueryClient()
  const computerStatus = useQuery({ queryKey: ['computer-status'], queryFn: () => api<ComputerStatus>('/api/computer/status'), refetchInterval: 5000 })
  const apps = useConnectedApps()
  const connect = async (app: string) => { try { setError(''); await connectRoomApp(room.id, app) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not connect app') } }
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Message['attachments']>([])
  const [error, setError] = useState('')
  const [modelError, setModelError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [stopped, setStopped] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const interactionRoot = useRef<HTMLElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => { pinned.current = true }, [room.id])
  useLayoutEffect(() => {
    if (pinned.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [messages, pending, turns])
  useLayoutEffect(() => {
    if (!textarea.current) return
    textarea.current.style.height = 'auto'
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 184)}px`
  }, [text])
  const approvalById = useMemo(() => new Map(approvals.map((approval) => [approval.id, approval])), [approvals])
  const active = turns.filter((turn) => ['running', 'waiting_approval'].includes(turn.status) && !stopped.includes(turn.id))
  const queued = turns.filter((turn, index) => turn.status === 'queued' && !stopped.includes(turn.id) && !active.some((item) => item.botId === turn.botId) && turns.findIndex((item) => item.status === 'queued' && !stopped.includes(item.id) && item.botId === turn.botId) === index)
  const newestRunning = [...turns].reverse().find((turn) => turn.status === 'running' && !stopped.includes(turn.id))
  const latest = messages.at(-1), companionBot = latest?.authorKind === 'bot' && latest.text.trim() ? memberBot(room, latest.authorId) : undefined
  const showCompanion = Boolean(latest && companionBot && !turns.some((turn) => ['running', 'queued'].includes(turn.status) && !stopped.includes(turn.id)) && !approvals.some((approval) => approval.status === 'pending' && (approval.turnId === latest.turnId || approval.botId === latest.authorId)))
  const roomName = room.name ?? room.members.find((member) => member.memberKind === 'bot')?.entity?.name ?? 'Room'
  const dmBot = room.kind === 'dm' ? room.members.map((member) => member.memberKind === 'bot' ? bots.find((bot) => bot.id === member.memberId) ?? member.entity : undefined).find((entity): entity is Bot => Boolean(entity && 'job' in entity)) : undefined
  const subtitle = dmBot?.job ?? `${room.members.length} members`
  const headerStatus = active.some((turn) => turn.status === 'waiting_approval') ? 'waiting' : active.some((turn) => turn.status === 'running') ? 'working' : undefined
  const submit = async () => {
    if ((!text.trim() && !attachments.length) || sending || uploading) return
    const content = text.trim()
    setText(''); setSending(true); setError('')
    try {
      if (/^\/connect(?:\s|$)/i.test(content)) { await connectRoomApp(room.id, content.replace(/^\/connect\s*/i, '')); return }
      const result = await api<{ message: Message; turns: PublicTurn[] }>(`/api/rooms/${room.id}/messages`, { method: 'POST', body: JSON.stringify({ text: content, attachments, clientRequestId: crypto.randomUUID() }) })
      props.onSent(result.message, result.turns)
      setAttachments([])
    } catch (reason) { setText(content); setError(reason instanceof Error ? reason.message : 'Send failed') }
    finally { setSending(false) }
  }
  const upload = async (file: File) => {
    if (file.size > 20 * 1024 ** 2) { setError('File limit is 20 MB'); return }
    setUploading(true); setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      const result = await api<{ attachment: Message['attachments'][number] }>(`/api/rooms/${room.id}/uploads`, { method: 'POST', body })
      setAttachments((current) => [...current, result.attachment])
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Upload failed') }
    finally { setUploading(false) }
  }
  const stop = async (id: string) => {
    setStopped((current) => [...current, id])
    try { await api(`/api/turns/${id}/cancel`, { method: 'POST' }) }
    catch { setStopped((current) => current.filter((value) => value !== id)); setError('Could not stop this turn') }
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
  return <section ref={interactionRoot} className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-surface text-fg">
    <header className="flex min-h-14 min-w-0 items-center gap-1 border-b border-line bg-surface px-4 max-[639px]:grid max-[639px]:grid-cols-[minmax(0,1fr)_auto] max-[639px]:px-2 max-[639px]:pt-1">
      <MembersPopover room={room} bots={bots} users={users} presence={presence} open={props.membersOpen} onOpenChange={props.onMembersOpenChange} onChanged={props.onMembersChanged} onRoomSettings={props.onSettings} trigger={<button type="button" aria-label="Members" onClick={props.onOpenMembers} className="flex min-w-0 max-w-[min(44vw,380px)] items-center rounded-md pr-2 text-left hover:bg-surface-2 max-[639px]:max-w-none max-[639px]:min-h-[44px]"><HeaderAvatars room={room} /><span className="ml-2 min-w-0"><h1 className="truncate text-[15px] font-semibold">{roomName}</h1><span className="block truncate text-xs text-fg-muted">{subtitle}</span></span></button>} />
      <SectionPicker roomId={room.id} trigger={<button data-testid="header-section-picker" data-assigned={assignedSection ? 'true' : 'false'} type="button" className="section-header-trigger inline-flex h-8 min-w-0 max-w-[180px] items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 px-2.5 text-xs font-medium text-fg-muted transition-[transform,background-color,color,border-color] duration-150 ease-out hover:bg-surface-3 hover:text-fg active:scale-[.97] max-[639px]:col-span-2 max-[639px]:row-start-2 max-[639px]:mb-2 max-[639px]:h-9 max-[639px]:max-w-[min(100%,220px)]"><SectionTriggerLabel roomId={room.id} /></button>} />
      <IconButton label="Room settings" onClick={props.onSettings} className="max-[639px]:hidden"><MoreHorizontal size={18} /></IconButton>
      <div className="min-w-4 flex-1 max-[639px]:hidden" />
      <div className="flex items-center gap-2 max-[639px]:col-start-2 max-[639px]:row-start-1 max-[639px]:gap-0">
        <div className="max-[639px]:hidden"><RoomApps room={room} /></div>
        <div className="hidden max-[639px]:block"><RoomApps room={room} compact /></div>
        <span className="relative">
          <IconButton label="Computer" kbd="⌘." aria-pressed={props.computerOpen} onClick={props.onToggleComputer} className="max-[639px]:h-[44px] max-[639px]:w-[44px]"><Monitor size={17} /></IconButton>
          {headerStatus && <span aria-hidden="true" className={`absolute right-0 top-0 h-1.5 w-1.5 rounded-full ${headerStatus === 'working' ? 'bg-working' : 'bg-waiting motion-safe:animate-pulse'}`} />}
        </span>
      </div>
    </header>
    <div ref={scroller} onScroll={(event) => { const element = event.currentTarget; pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 80 }} className="scrollbar-thin min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-[760px] px-6 py-6 max-[639px]:px-3 max-[639px]:py-4">{messages.map((message, index) => {
        const grouped = groupedWithPrevious(messages[index - 1], message)
        const day = new Date(message.createdAt).toDateString()
        const showDay = day !== lastDay
        lastDay = day
        const bot = memberBot(room, message.authorId)
        const human = memberUser(room, message.authorId)
        const mine = message.authorKind === 'user' && message.authorId === user.id
        const approvalId = message.attachments.find((item) => item.subtype === 'approval')?.approvalId
        const approval = typeof approvalId === 'string' ? approvalById.get(approvalId) : undefined
        const system = message.authorKind === 'system' && !message.attachments.some((item) => item.subtype === 'welcome')
        const files = message.attachments.filter((item) => item.subtype === 'file')
        return <div key={message.id}>
          {showDay && <div className="my-5 flex items-center gap-3 text-[11px] font-medium text-fg-subtle"><span className="h-px flex-1 bg-line" />{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(message.createdAt))}<span className="h-px flex-1 bg-line" /></div>}
          {approval ? <ApprovalCard approval={approval} onUpdate={props.onApproval} desktopAvailable={Boolean(computerStatus.data?.desktop?.stream)} onTakeOver={takeOver} /> : mine
            ? <div className={`group relative flex min-w-0 justify-end ${grouped ? 'mb-1' : 'mb-4'}`}><div className="relative min-w-0 max-w-[72%] max-[639px]:max-w-[88%]"><div className="message-markdown min-w-0 rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-fg"><MessageMarkdown text={message.text} />{files.map((file, fileIndex) => <span key={fileIndex} title={String(file.path)} className="mt-2 flex min-w-0 items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs"><Paperclip size={12} className="shrink-0" /><span className="min-w-0 truncate">{String(file.name)} · {Math.ceil(Number(file.size) / 1024)} KB</span></span>)}</div><time className="pointer-events-none absolute -bottom-3 right-1 z-10 rounded bg-surface px-1 text-[10px] text-fg-subtle opacity-0 group-hover:opacity-100">{formatTime(message.createdAt)}</time></div></div>
            : <div className={`group relative flex min-w-0 max-w-[82%] items-start gap-2 max-[639px]:max-w-[96%] ${grouped ? 'mb-1' : 'mb-4'}`}>
              {grouped || (showCompanion && message.id === latest?.id) ? <div className="w-7 shrink-0" /> : bot ? <BotAvatar {...bot.avatar} size={28} label={bot.name} /> : human ? <HumanAvatar name={human.name} size={28} /> : <div className="w-7 shrink-0" />}
              <div className="relative min-w-0">
                {!grouped && <span className="mb-1 block text-xs font-semibold text-fg-muted" style={botLabelStyle(bot?.avatar.color)}>{bot?.name ?? human?.name ?? 'System'}</span>}
                <div className={`message-markdown min-w-0 max-w-[68ch] text-fg ${system ? 'rounded-md border border-line border-l-[var(--color-waiting)] bg-surface-2 px-3 py-2 shadow-card' : ''}`} style={system ? { fontSize: 13 } : undefined}><MessageMarkdown text={message.text} />{files.map((file, fileIndex) => <span key={fileIndex} title={String(file.path)} className="mt-2 flex min-w-0 items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs"><Paperclip size={12} className="shrink-0" /><span className="min-w-0 truncate">{String(file.name)} · {Math.ceil(Number(file.size) / 1024)} KB</span></span>)}</div>
                <time className="pointer-events-none absolute -bottom-3 right-1 z-10 rounded bg-surface px-1 text-[10px] text-fg-subtle opacity-0 group-hover:opacity-100">{formatTime(message.createdAt)}</time>
              </div>
            </div>}
        </div>
      })}
      {showCompanion && latest && companionBot && <BotCompanion bot={companionBot} message={latest} viewportRef={scroller} interactionRootRef={interactionRoot} />}
      {active.map((turn) => {
        const bot = memberBot(room, turn.botId), streamed = pending[turn.id], state = turn.status === 'waiting_approval' ? 'waiting' : 'working'
        return <div key={turn.id} className="mb-4 flex max-w-[82%] items-start gap-2">{bot && <BotWorkstation {...bot.avatar} size={32} state={state} identity={`${bot.id}:${turn.id}`} label={bot.name} />}<div className="min-w-0 pt-1"><span className="mb-1 block text-xs font-semibold" style={botLabelStyle(bot?.avatar.color)}>{bot?.name}</span><div className="text-[15px] leading-[1.55] text-fg">{streamed ? <div className="message-markdown max-w-[68ch]"><MessageMarkdown text={streamed} /></div> : <span className="text-fg-muted">{state === 'waiting' ? 'is waiting for approval' : <>is working<span>…</span></>}</span>}{state === 'working' && <button type="button" onClick={() => void stop(turn.id)} className="ml-3 text-xs text-fg-muted underline" aria-label={`Stop ${bot?.name ?? 'bot'}`}>Stop</button>}</div></div></div>
      })}
      {queued.map((turn) => {
        const bot = memberBot(room, turn.botId)
        return <div key={turn.id} className="mb-4 flex max-w-[82%] items-start gap-2">{bot && <BotAvatar {...bot.avatar} size={28} label={bot.name} />}<div><span className="mb-1 block text-xs font-semibold" style={botLabelStyle(bot?.avatar.color)}>{bot?.name}</span><div className="text-[15px] leading-[1.55] text-fg-muted">is thinking<span>…</span><button type="button" onClick={() => void stop(turn.id)} className="ml-3 text-xs underline" aria-label={`Stop ${bot?.name ?? 'bot'}`}>Stop</button></div></div></div>
      })}
      <div id="thread-bottom" /></div>
    </div>
    <div className="bg-surface px-4 pb-4 pt-2 max-[639px]:px-3 max-[639px]:pb-[max(12px,env(safe-area-inset-bottom))]">
      <ConnectAutocomplete text={text} apps={apps.data?.apps ?? []} onSelect={(app) => { setText(''); void connect(app) }} />
      {error && <p role="alert" className="mx-auto mb-2 max-w-[760px] text-xs text-danger">{error}</p>}
      {attachments.length > 0 && <div className="mx-auto mb-2 flex max-w-[760px] flex-wrap gap-2">{attachments.map((file, index) => <button type="button" key={index} title={`Remove ${String(file.name)}`} onClick={() => setAttachments((current) => current.filter((_, fileIndex) => fileIndex !== index))} className="max-w-full truncate rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-fg-muted">{String(file.name)} ×</button>)}</div>}
      <div className="mx-auto max-w-[760px] rounded-2xl border border-line bg-surface-2 p-2 shadow-card focus-within:border-line-strong">
        <textarea ref={textarea} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} rows={1} placeholder={`Message ${roomName}`} className="block max-h-[184px] min-h-9 w-full resize-none overflow-y-auto bg-transparent px-2 py-2 text-[15px] leading-6 text-fg outline-none placeholder:text-fg-subtle max-[639px]:text-[16px]" />
        <div className="mt-1 flex items-center justify-between gap-2">
          <input ref={fileInput} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '' }} />
          <IconButton label="Attach file" disabled={uploading || attachments.length >= 10} onClick={() => fileInput.current?.click()} className="max-[639px]:h-[44px] max-[639px]:w-[44px]"><Plus size={18} /></IconButton>
          <div className="flex min-w-0 items-center gap-1">
            {dmBot && <ModelPicker bot={dmBot} roomId={room.id} onError={setModelError} />}
            {newestRunning && !text.trim() ? <button type="button" onClick={() => void stop(newestRunning.id)} aria-label="Stop" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-fg hover:opacity-90 max-[639px]:h-[44px] max-[639px]:w-[44px]"><Square size={13} fill="currentColor" /></button> : <button type="button" disabled={(!text.trim() && !attachments.length) || sending || uploading} onClick={() => void submit()} aria-label="Send" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-fg hover:opacity-90 disabled:bg-surface-4 disabled:text-fg-subtle max-[639px]:h-[44px] max-[639px]:w-[44px]"><ArrowUp size={16} /></button>}
          </div>
        </div>
      </div>
      {modelError && <p role="alert" className="mx-auto mt-2 max-w-[760px] text-xs text-danger">{modelError}</p>}
    </div>
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
  const ghost = 'rounded-md border border-line-strong bg-transparent px-4 py-2 text-sm text-fg hover:bg-surface-3'
  return <div className="mb-5 max-w-lg rounded-lg border border-waiting/35 bg-surface-2 p-4 shadow-card">
    <p className="text-xs font-semibold uppercase tracking-wide text-waiting">Approval requested</p>
    <p className="mt-2 text-sm text-fg">{approval.summary}</p>
    <details className="mt-2 text-xs text-fg-muted"><summary className="cursor-pointer">Details</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-3 p-2">{JSON.stringify(approval.input, null, 2)}</pre></details>
    {approval.status === 'pending' ? <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void decide('approve')} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg">Approve</button>
      <button type="button" disabled={busy} onClick={() => void decide('deny')} className={ghost}>Not now</button>
      {browserApproval && <button type="button" disabled={busy} onClick={() => void takeOver()} className={ghost}>Take over</button>}
      {browserApproval && <button type="button" disabled={busy} onClick={() => void decide('human_completed')} className={ghost}>Done by me</button>}
    </div> : <p className="mt-3 text-sm font-medium capitalize text-fg-muted">{approval.status}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
  </div>
}
