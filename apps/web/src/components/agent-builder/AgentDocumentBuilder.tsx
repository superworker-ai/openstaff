import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, BriefcaseBusiness, Check, ChevronRight, Diamond, Image, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react'
import { MODEL_CATALOG, type Bot } from '@openstaff/shared'
import { AvatarBuilder } from '../AvatarBuilder'
import { BotAvatar } from '../BotAvatar'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { api } from '../../lib/api'
import type { BotTemplate, RoomData, RoomView } from '../../lib/loaders'
import { MODEL_GROUPS } from '../../lib/models'
import {
  AGENT_DOCUMENT_COVERS,
  AGENT_DOCUMENT_LIMITS,
  applyAgentTemplate,
  buildAgentDocumentBotPatch,
  captureAgentDocumentDraft,
  createAgentDocument,
  createAgentDocumentForBot,
  getAgentDocumentContentFingerprint,
  getAgentDocumentCoverStorageKey,
  getAgentDocumentStorageKey,
  getAgentEditDocumentStorageKey,
  getLegacyAgentDocumentStorageKeys,
  normalizeAgentInstructions,
  parseAgentDocumentCover,
  parseAgentDocumentDraft,
  parseAgentEditDocumentDraft,
  serializeAgentDocumentDraft,
  serializeAgentEditDocumentDraft,
  type AgentDocumentBlock,
  type AgentDocumentDraft,
} from '../../lib/agent-document'
import type { AgentRichTextEditorHandle } from './AgentRichTextEditor'
import './agent-document.css'

const AgentRichTextEditor = lazy(() => import('./AgentRichTextEditor'))

const approvalDescriptions = {
  writes: 'Ask before actions that change files, systems, browsers, or connected apps.',
  all: 'Ask before every tool action.',
  auto: 'Use tools automatically, except when an app needs to be connected.',
}

type AgentDocumentBuilderProps = {
  mode?: 'create'
  templates: BotTemplate[]
  userId: string
} | {
  mode: 'edit'
  templates: BotTemplate[]
  userId: string
  bot: Bot
  rooms: RoomView[]
}

function GrowingTextarea({ value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }, [value])
  return <textarea {...props} ref={ref} value={value} rows={1} />
}

function refreshBotInRoomData(current: RoomData | undefined, updated: Bot): RoomData | undefined {
  if (!current) return current
  const refresh = (room: RoomView): RoomView => ({
    ...room,
    members: room.members.map((member) => member.memberKind === 'bot' && member.memberId === updated.id
      ? { ...member, entity: updated }
      : member),
  })
  return {
    ...current,
    bots: current.bots.map((item) => item.id === updated.id ? updated : item),
    room: refresh(current.room),
    rooms: current.rooms.map(refresh),
  }
}

function findBotRoom(rooms: readonly RoomView[], botId: string): RoomView | undefined {
  return rooms.find((room) => room.kind === 'dm'
    && room.members.some((member) => member.memberKind === 'bot' && member.memberId === botId))
}

export function AgentDocumentBuilder(props: AgentDocumentBuilderProps) {
  const { templates, userId } = props
  const editingBot = props.mode === 'edit' ? props.bot : null
  const editing = editingBot !== null
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(() => editingBot
    ? createAgentDocumentForBot(editingBot, templates)
    : createAgentDocument(templates[0]!))
  const current = useRef(draft)
  const storageKey = editingBot
    ? getAgentEditDocumentStorageKey(userId, editingBot.id)
    : getAgentDocumentStorageKey(userId)
  const coverStorageKey = editingBot ? getAgentDocumentCoverStorageKey(userId, editingBot.id) : null
  const legacyStorageKeys = useMemo(
    () => editingBot ? [] : getLegacyAgentDocumentStorageKeys(userId),
    [editingBot, userId],
  )
  const [ready, setReady] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  const editorReadyRef = useRef(false)
  const [initialMarkdown, setInitialMarkdown] = useState<string | undefined>(editingBot?.instructions)
  const originalInstructions = useRef(editingBot?.instructions ?? '')
  const instructionsDirty = useRef(false)
  const contentFingerprint = useRef('')
  const [storageStatus, setStorageStatus] = useState('Local draft')
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [templateUndo, setTemplateUndo] = useState<AgentDocumentDraft | null>(null)
  const [editorRevision, setEditorRevision] = useState(0)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const submissionSucceeded = useRef(false)
  const [error, setError] = useState('')
  const errorRef = useRef<HTMLParagraphElement>(null)
  const editorRef = useRef<AgentRichTextEditorHandle>(null)

  const readLiveDraft = useCallback(() => {
    const liveBlocks = editorRef.current?.getBlocks()
    return liveBlocks ? captureAgentDocumentDraft(current.current, liveBlocks) : current.current
  }, [])

  const serializeLiveDraft = useCallback((liveDraft: AgentDocumentDraft) => editingBot
    ? serializeAgentEditDocumentDraft(editingBot, {
        draft: liveDraft,
        originalInstructions: originalInstructions.current,
        instructionsDirty: instructionsDirty.current,
      })
    : serializeAgentDocumentDraft(liveDraft), [editingBot])

  useEffect(() => {
    try {
      if (editingBot) {
        const storedCover = parseAgentDocumentCover(coverStorageKey ? localStorage.getItem(coverStorageKey) : null)
        const serverDraft = createAgentDocumentForBot(editingBot, templates, storedCover ?? 'frontier-day')
        current.current = serverDraft
        setDraft(serverDraft)
        setInitialMarkdown(editingBot.instructions)
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const restored = parseAgentEditDocumentDraft(raw, editingBot, templates)
          if (restored.status === 'restored') {
            current.current = restored.value.draft
            setDraft(restored.value.draft)
            setInitialMarkdown(undefined)
            originalInstructions.current = restored.value.originalInstructions
            instructionsDirty.current = restored.value.instructionsDirty
            setStorageStatus('Draft restored')
          } else {
            setStorageBlocked(true)
            setStorageStatus(restored.status === 'stale' ? 'Saved draft is out of date' : 'Saved draft needs recovery')
            setError(restored.status === 'stale'
              ? 'This browser draft is based on an older version of the agent. Load the current agent to continue.'
              : 'This saved draft could not be opened. It is still stored in this browser.')
          }
        }
      } else {
        const currentRaw = localStorage.getItem(storageKey)
        const legacyEntry = currentRaw
          ? null
          : legacyStorageKeys.map((key) => [key, localStorage.getItem(key)] as const).find((entry) => entry[1] !== null)
        const legacyRaw = legacyEntry?.[1] ?? null
        const restored = parseAgentDocumentDraft(currentRaw ?? legacyRaw ?? '', templates)
        if (restored) {
          current.current = restored
          setDraft(restored)
          setStorageStatus(legacyRaw ? 'Older draft restored' : 'Draft restored')
        } else if (currentRaw || legacyRaw) {
          setStorageBlocked(true)
          setStorageStatus('Saved draft needs recovery')
          setError('This saved draft could not be opened. It is still stored in this browser.')
        }
      }
    } catch {
      setStorageStatus('Draft saving unavailable')
    }
    setReady(true)
  }, [coverStorageKey, editingBot, legacyStorageKeys, storageKey, templates])

  useEffect(() => {
    if (!ready || !editorReady || storageBlocked) return
    setStorageStatus('Saving…')
    const timer = window.setTimeout(() => {
      if (submissionSucceeded.current) return
      try {
        localStorage.setItem(storageKey, serializeLiveDraft(readLiveDraft()))
        for (const key of legacyStorageKeys) localStorage.removeItem(key)
        setStorageStatus('Saved locally')
      } catch {
        setStorageStatus('Draft saving unavailable')
      }
    }, 220)
    return () => window.clearTimeout(timer)
  }, [draft, editorReady, legacyStorageKeys, readLiveDraft, ready, serializeLiveDraft, storageBlocked, storageKey])

  useEffect(() => {
    if (!ready || !editorReady || storageBlocked) return
    const flush = () => {
      if (submissionSucceeded.current) return
      try { localStorage.setItem(storageKey, serializeLiveDraft(readLiveDraft())) } catch { /* Storage may be unavailable. */ }
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [editorReady, readLiveDraft, ready, serializeLiveDraft, storageBlocked, storageKey])

  useEffect(() => {
    if (!ready || storageBlocked || !coverStorageKey) return
    try { localStorage.setItem(coverStorageKey, draft.cover) } catch { /* Cover persistence is optional. */ }
  }, [coverStorageKey, draft.cover, ready, storageBlocked])

  const update = useCallback((
    patch: Partial<AgentDocumentDraft>,
    options: { preserveTemplateUndo?: boolean; preserveError?: boolean } = {},
  ) => {
    if (!options.preserveTemplateUndo) setTemplateUndo(null)
    if (!storageBlocked && !options.preserveError) setError('')
    const next = { ...current.current, ...patch }
    current.current = next
    setDraft(next)
  }, [storageBlocked])

  const handleEditorChange = useCallback((blocks: AgentDocumentBlock[]) => {
    if (!editorReadyRef.current) return
    const fingerprint = getAgentDocumentContentFingerprint(blocks)
    if (fingerprint === contentFingerprint.current) return
    contentFingerprint.current = fingerprint
    if (editing) instructionsDirty.current = true
    update({ blocks }, { preserveError: true })
  }, [editing, update])

  const handleEditorReady = useCallback((blocks: AgentDocumentBlock[]) => {
    const next = captureAgentDocumentDraft(current.current, blocks)
    current.current = next
    contentFingerprint.current = getAgentDocumentContentFingerprint(blocks)
    editorReadyRef.current = true
    setDraft(next)
    setEditorReady(true)
  }, [])

  const handleEditorImportError = useCallback(() => {
    editorReadyRef.current = false
    setEditorReady(false)
    setStorageBlocked(true)
    setStorageStatus('Instructions need recovery')
    setError('These instructions could not be opened in the editor. The original agent is unchanged.')
  }, [])

  function chooseTemplate(id: string) {
    if (editing) return
    const template = templates.find((item) => item.id === id)
    if (!template || id === current.current.templateId) return
    const previous = readLiveDraft()
    current.current = previous
    setTemplateUndo(previous)
    update(applyAgentTemplate(previous, template), { preserveTemplateUndo: true })
    editorReadyRef.current = false
    setEditorReady(false)
    setEditorRevision((value) => value + 1)
  }

  function undoTemplateChange() {
    if (!templateUndo || editing) return
    update(templateUndo)
    editorReadyRef.current = false
    setEditorReady(false)
    setEditorRevision((value) => value + 1)
    requestAnimationFrame(() => document.getElementById('agent-template')?.focus())
  }

  function flushDraft() {
    if (storageBlocked) return
    try {
      localStorage.setItem(storageKey, serializeLiveDraft(readLiveDraft()))
      setStorageStatus('Saved locally')
    } catch {
      setStorageStatus('Draft saving unavailable')
    }
  }

  function startFreshDraft() {
    submissionSucceeded.current = false
    try {
      localStorage.removeItem(storageKey)
      for (const key of legacyStorageKeys) localStorage.removeItem(key)
    } catch { /* A fresh in-memory draft is still usable. */ }
    setStorageBlocked(false)
    setStorageStatus('Local draft')
    setError('')
    if (editingBot) {
      const next = createAgentDocumentForBot(editingBot, templates, draft.cover)
      originalInstructions.current = editingBot.instructions
      instructionsDirty.current = false
      current.current = next
      setDraft(next)
      setInitialMarkdown(editingBot.instructions)
      editorReadyRef.current = false
      setEditorReady(false)
      setEditorRevision((value) => value + 1)
    }
  }

  function clearDraftStorage() {
    try {
      localStorage.removeItem(storageKey)
      for (const key of legacyStorageKeys) localStorage.removeItem(key)
    } catch { /* The server mutation is already complete. */ }
  }

  async function navigateAfterEdit(updated: Bot) {
    const knownRooms = props.mode === 'edit' ? props.rooms : []
    let destination = findBotRoom(knownRooms, updated.id)
    try {
      const response = await api<{ rooms: RoomView[] }>('/api/rooms')
      destination = findBotRoom(response.rooms, updated.id) ?? destination
    } catch { /* The loaded room list is a safe fallback. */ }
    try {
      if (destination) await navigate({ to: '/rooms/$roomId', params: { roomId: destination.id } })
      else await navigate({ to: '/' })
    } catch {
      window.location.assign(destination ? `/rooms/${encodeURIComponent(destination.id)}` : '/')
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const submitId = editing ? 'save-agent-submit' : 'create-agent-submit'
    if (!(submitter instanceof HTMLButtonElement) || submitter.id !== submitId) return
    if (!ready || !editorReady || storageBlocked || submitting.current) return

    submitting.current = true
    const exportedInstructions = normalizeAgentInstructions(editorRef.current?.getMarkdown() ?? '')
    const instructions = editing && !instructionsDirty.current ? originalInstructions.current : exportedInstructions
    const submissionDraft = readLiveDraft()
    current.current = submissionDraft
    setDraft(submissionDraft)
    flushDraft()

    const modelIsAvailable = submissionDraft.model === ''
      || MODEL_CATALOG.some((model) => model.id === submissionDraft.model)
      || Boolean(editingBot && submissionDraft.model === (editingBot.model ?? ''))
    if (!submissionDraft.name.trim() || !submissionDraft.job.trim() || instructions.length > AGENT_DOCUMENT_LIMITS.instructions || !modelIsAvailable) {
      setError(!modelIsAvailable
        ? `Choose an available model before ${editing ? 'saving' : 'creating your agent'}.`
        : instructions.length > AGENT_DOCUMENT_LIMITS.instructions
          ? 'Keep the instructions under 20,000 characters.'
          : `Give your agent a name and a role before ${editing ? 'saving' : 'creating it'}.`)
      submitting.current = false
      requestAnimationFrame(() => errorRef.current?.focus())
      return
    }

    setPending(true)
    setError('')

    if (editingBot) {
      let updated: Bot
      try {
        const patch = buildAgentDocumentBotPatch(
          editingBot,
          submissionDraft,
          instructions,
          instructionsDirty.current,
        )
        if (Object.keys(patch).length > 0) {
          const response = await api<{ bot: Bot }>(`/api/bots/${editingBot.id}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
          })
          updated = response.bot
        } else {
          updated = editingBot
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not save changes. Your draft is still here.')
        submitting.current = false
        setPending(false)
        requestAnimationFrame(() => errorRef.current?.focus())
        return
      }

      submissionSucceeded.current = true
      clearDraftStorage()
      if (coverStorageKey) {
        try { localStorage.setItem(coverStorageKey, submissionDraft.cover) } catch { /* Cover persistence is optional. */ }
      }
      queryClient.setQueriesData<RoomData>({ queryKey: ['room-data'] }, (value) => refreshBotInRoomData(value, updated))
      queryClient.setQueriesData<{ bots: Bot[] }>({ queryKey: ['settings-bots'] }, (value) => value
        ? { ...value, bots: value.bots.map((item) => item.id === updated.id ? updated : item) }
        : value)
      void queryClient.invalidateQueries({ queryKey: ['settings-bots'] })
      await navigateAfterEdit(updated)
      return
    }

    let roomId: string
    try {
      const response = await api<{ bot: Bot; room: { id: string } }>('/api/bots', {
        method: 'POST',
        body: JSON.stringify({
          templateId: submissionDraft.templateId,
          name: submissionDraft.name.trim(),
          job: submissionDraft.job.trim(),
          instructions,
          avatar: submissionDraft.avatar,
          model: submissionDraft.model || null,
          approvalPolicy: submissionDraft.approvalPolicy,
        }),
      })
      roomId = response.room.id
      try {
        localStorage.setItem(getAgentDocumentCoverStorageKey(userId, response.bot.id), submissionDraft.cover)
      } catch { /* Cover persistence is optional. */ }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create agent. Your draft is still here.')
      submitting.current = false
      setPending(false)
      requestAnimationFrame(() => errorRef.current?.focus())
      return
    }

    submissionSucceeded.current = true
    clearDraftStorage()
    try {
      await navigate({ to: '/rooms/$roomId', params: { roomId } })
    } catch {
      window.location.assign(`/rooms/${encodeURIComponent(roomId)}`)
    }
  }

  const catalogHasModel = draft.model === '' || MODEL_CATALOG.some((model) => model.id === draft.model)
  const modelIsAvailable = catalogHasModel || Boolean(editingBot && draft.model === (editingBot.model ?? ''))
  const originalCustomModel = editingBot?.model && !MODEL_CATALOG.some((model) => model.id === editingBot.model)
    ? editingBot.model
    : null
  const selectedCover = AGENT_DOCUMENT_COVERS.find((cover) => cover.id === draft.cover)
  const submitId = editing ? 'save-agent-submit' : 'create-agent-submit'

  return <div className="agent-document">
    <header className="agent-document-bar">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
        <Link to="/" className="text-fg-muted hover:text-fg">Agents</Link>
        <ChevronRight size={13} className="shrink-0 text-fg-subtle" />
        <BotAvatar {...draft.avatar} size={20} />
        <span className="truncate">{draft.name.trim() || 'Untitled agent'}</span>
      </nav>
      <div className="flex shrink-0 items-center gap-3">
        <span className="agent-document-save text-xs text-fg-muted" role="status">{storageStatus}</span>
        <button
          id={submitId}
          type="submit"
          form="agent-document-form"
          disabled={!ready || !editorReady || storageBlocked || pending}
          className="agent-document-create"
        >
          {pending ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save changes' : 'Create agent')}<ArrowUpRight size={15} />
        </button>
      </div>
    </header>

    <form
      id="agent-document-form"
      className="agent-document-scroll"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault()
      }}
    >
      <fieldset disabled={!ready || pending} className="min-w-0 border-0 p-0">
        <div
          className="agent-document-cover"
          data-cover={draft.cover}
          style={selectedCover ? { backgroundImage: `url(${selectedCover.src})` } : undefined}
        >
          <div className="agent-document-cover-actions">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button"><Image size={13} />{draft.cover === 'none' ? 'Add cover' : 'Change cover'}</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent label="Choose a cover" align="end" className="agent-document-cover-menu">
                {AGENT_DOCUMENT_COVERS.map((cover) => <DropdownMenuItem
                  key={cover.id}
                  aria-current={draft.cover === cover.id ? 'true' : undefined}
                  onSelect={() => update({ cover: cover.id })}
                >
                  <img src={cover.src} alt="" />
                  <span>{cover.label}</span>
                  {draft.cover === cover.id && <Check size={14} />}
                </DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            {draft.cover !== 'none' && <button type="button" onClick={() => update({ cover: 'none' })}>Remove</button>}
          </div>
        </div>

        <article className="agent-document-page">
          <div className="agent-document-identity">
            <button type="button" className="agent-document-icon" aria-label="Edit appearance" onClick={() => setAppearanceOpen(true)}>
              <BotAvatar {...draft.avatar} size={64} />
              <span>Edit appearance</span>
            </button>
            <span className="agent-document-badge">{editing ? 'Editing agent' : 'Agent draft'}</span>
          </div>
          <h1 className="sr-only">{draft.name.trim() || 'Untitled agent'}</h1>
          <GrowingTextarea
            aria-label="Agent name"
            required
            maxLength={AGENT_DOCUMENT_LIMITS.name}
            value={draft.name}
            onChange={(event) => update({ name: event.target.value.replace(/\n/g, '') })}
            onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }}
            className="agent-document-title"
            placeholder="Untitled agent"
          />

          <div className="agent-document-properties">
            <label htmlFor="agent-role"><BriefcaseBusiness size={15} />Role</label>
            <input id="agent-role" required maxLength={AGENT_DOCUMENT_LIMITS.job} placeholder="One clear responsibility" value={draft.job} onChange={(event) => update({ job: event.target.value })} />

            {!editing && <>
              <label htmlFor="agent-template"><Sparkles size={15} />Starting point</label>
              <select id="agent-template" value={draft.templateId} onChange={(event) => chooseTemplate(event.target.value)}>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </>}

            <label htmlFor="agent-approvals"><ShieldCheck size={15} />Approvals</label>
            <select
              id="agent-approvals"
              title={approvalDescriptions[draft.approvalPolicy]}
              value={draft.approvalPolicy}
              onChange={(event) => update({ approvalPolicy: event.target.value as AgentDocumentDraft['approvalPolicy'] })}
            >
              <option value="writes">Approve writes</option>
              <option value="all">Approve everything</option>
              <option value="auto">Automatic</option>
            </select>

            <label htmlFor="agent-model"><Diamond size={15} />Model</label>
            <select id="agent-model" aria-invalid={!modelIsAvailable || undefined} value={draft.model} onChange={(event) => update({ model: event.target.value })}>
              <option value="">Workspace default</option>
              {originalCustomModel && <option value={originalCustomModel}>Current model: {originalCustomModel}</option>}
              {!catalogHasModel && draft.model !== originalCustomModel && <option value={draft.model}>Unavailable: {draft.model}</option>}
              {MODEL_GROUPS.map((group) => <optgroup key={group.prefix} label={group.label}>
                {MODEL_CATALOG.filter((model) => model.id.split('/')[0] === group.prefix).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </optgroup>)}
            </select>
            {!modelIsAvailable && <p className="agent-document-model-description">Choose another model or use the workspace default.</p>}
          </div>

          {!editing && templateUndo && <div className="agent-document-template-undo" role="status">
            <span>Starting point replaced the role, appearance, and instructions.</span>
            <button type="button" onClick={undoTemplateChange}><RotateCcw size={13} />Undo</button>
            <button type="button" aria-label="Dismiss" onClick={() => setTemplateUndo(null)}><X size={13} /></button>
          </div>}

          <div className="agent-document-editor-heading">
            <h2>Instructions</h2>
            <span>Type / for blocks</span>
          </div>

          <section aria-label="Agent instructions" className="agent-document-editor-shell">
            {ready ? <Suspense fallback={<EditorPlaceholder />}>
              <AgentRichTextEditor
                key={editorRevision}
                ref={editorRef}
                blocks={draft.blocks}
                initialMarkdown={initialMarkdown}
                disabled={pending || storageBlocked}
                onChange={handleEditorChange}
                onImportError={handleEditorImportError}
                onReady={handleEditorReady}
              />
            </Suspense> : <EditorPlaceholder />}
          </section>

          {error && <div className="agent-document-error">
            <p ref={errorRef} tabIndex={-1} role="alert">{error}</p>
            {storageBlocked && <button type="button" onClick={startFreshDraft}>{editing ? 'Load current agent' : 'Start a fresh draft'}</button>}
          </div>}
          <footer className="agent-document-footer">
            <span>Draft and cover are saved in this browser.</span>
          </footer>
        </article>
      </fieldset>
    </form>

    <Dialog open={appearanceOpen} onOpenChange={setAppearanceOpen}>
      <DialogContent label="Agent appearance" className="p-5">
        <div className="mb-5 flex items-center justify-between">
          <DialogTitle className="text-lg font-semibold">Appearance</DialogTitle>
          <DialogClose asChild><button type="button" aria-label="Close appearance" className="rounded p-1 hover:bg-surface-3"><X size={18} /></button></DialogClose>
        </div>
        <p className="mb-4 text-sm text-fg-muted">Make your agent recognizable. Movement controls its animation.</p>
        <AvatarBuilder value={draft.avatar} onChange={(avatar) => update({ avatar })} name={draft.name || 'Your agent'} movementLabel="Movement" />
      </DialogContent>
    </Dialog>
  </div>
}

function EditorPlaceholder() {
  return <div className="agent-document-editor-placeholder" aria-hidden="true">
    <span /><span /><span /><span />
  </div>
}
