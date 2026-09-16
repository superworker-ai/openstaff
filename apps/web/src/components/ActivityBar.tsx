import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Camera, Check, ChevronDown, Copy, File, Globe2, Keyboard, MousePointer2, Terminal, Wrench, X } from 'lucide-react'
import { pairActivityEvents, type ActivityEntry, type ActivityIcon, type PublicTurn, type TurnEvent } from '@openstaff/shared'

interface Props {
  events: TurnEvent[]
  turn?: PublicTurn
  open: boolean
  onOpenChange: (open: boolean) => void
  leaseControls: ReactNode
  openTasks?: ReactNode
}

interface PhaseGroup {
  id: string
  label: string
  steps: ActivityEntry[]
}

const icons: Record<ActivityIcon, typeof Terminal> = {
  terminal: Terminal,
  file: File,
  globe: Globe2,
  pointer: MousePointer2,
  camera: Camera,
  keyboard: Keyboard,
  tool: Wrench,
}

function formatDuration(milliseconds?: number): string {
  if (milliseconds === undefined) return ''
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)}s` : `${milliseconds}ms`
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function lowerFirst(value: string): string {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value
}

async function copy(value: string): Promise<void> {
  try { await navigator.clipboard.writeText(value) } catch { /* Clipboard permissions are optional in embedded views. */ }
}

function groupEntries(entries: ActivityEntry[]): PhaseGroup[] {
  const groups: PhaseGroup[] = []
  let current: PhaseGroup | undefined
  for (const entry of entries) {
    if (entry.kind === 'phase') {
      current = { id: entry.event.id, label: entry.verb, steps: [] }
      groups.push(current)
      continue
    }
    if (!current) {
      current = { id: `working-${entry.event.id}`, label: 'Working', steps: [] }
      groups.push(current)
    }
    current.steps.push(entry)
  }
  return groups
}

function groupDuration(group: PhaseGroup): number {
  return group.steps.reduce((total, step) => total + (step.result?.durationMs ?? 0), 0)
}

function logText(entry: ActivityEntry): string {
  const lines = [
    entry.raw ? `$ ${entry.raw}` : '',
    entry.result?.output ?? '',
    [entry.toolName, entry.result?.exitCode === undefined ? entry.state : `exit ${entry.result.exitCode}`, formatDuration(entry.result?.durationMs)].filter(Boolean).join(' · '),
  ].filter(Boolean)
  return lines.join('\n')
}

function StepIcon({ entry }: { entry: ActivityEntry }) {
  const Icon = icons[entry.icon]
  return <span className="activity-step-icon" aria-hidden="true">
    <Icon size={14} />
    <span className="activity-step-badge">{entry.state === 'fail' ? <X size={7} /> : <Check size={7} />}</span>
  </span>
}

function StepRow({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const rawLog = logText(entry)
  const outputLines = rawLog.split('\n')
  const visibleLog = outputLines.length > 40 ? `${outputLines.slice(0, 40).join('\n')}\n…` : rawLog

  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setMounted(true)) })
    return () => { cancelAnimationFrame(first); if (second) cancelAnimationFrame(second) }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    setExpanded((value) => !value)
  }

  return <div className="activity-step" data-state={entry.state} data-expanded={expanded} data-mounted={mounted}>
    <div className="activity-step-summary" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} onKeyDown={onKeyDown}>
      <StepIcon entry={entry} />
      <span className="activity-step-text">
        <span className="activity-step-line"><span className="activity-step-verb">{entry.verb}</span>{entry.objectIsCode ? <code>{entry.object}</code> : <span>{entry.object}</span>}</span>
        {(entry.detail || entry.result?.exitCode !== undefined) && <span className="activity-step-detail">{[entry.detail, entry.result?.exitCode === undefined ? '' : `exit ${entry.result.exitCode}`].filter(Boolean).join(' · ')}</span>}
      </span>
      <span className="activity-step-meta"><span>{formatDuration(entry.result?.durationMs)}</span><ChevronDown size={12} /></span>
    </div>
    <div className="activity-step-log" aria-hidden={!expanded}><div><pre>{visibleLog || 'No output'}</pre><div className="activity-log-meta"><span>{entry.toolName ?? entry.event.type}</span><span>{entry.result?.exitCode === undefined ? entry.state : `exit ${entry.result.exitCode} · ${formatDuration(entry.result.durationMs)}`}</span><button type="button" onClick={() => void copy(rawLog)}><Copy size={11} />Copy</button></div></div></div>
  </div>
}

function Phase({ group, open, onToggle }: { group: PhaseGroup; open: boolean; onToggle: () => void }) {
  return <section className="activity-phase" data-open={open}>
    <button type="button" className="activity-phase-header" aria-expanded={open} onClick={onToggle}>
      <ChevronDown size={12} />
      <span>{group.label}</span>
      <span className="activity-phase-summary">{group.steps.length} {group.steps.length === 1 ? 'step' : 'steps'} · {formatDuration(groupDuration(group)) || '0ms'}</span>
    </button>
    <div className="activity-phase-body"><div>{group.steps.map((entry) => <StepRow key={entry.event.id} entry={entry} />)}</div></div>
  </section>
}

export function ActivityBar({ events, turn, open, onOpenChange, leaseControls, openTasks }: Props) {
  const drawerId = useId()
  const entries = useMemo(() => pairActivityEvents(events).slice(-300), [events])
  const groups = useMemo(() => groupEntries(entries), [entries])
  const steps = useMemo(() => entries.filter((entry) => entry.kind === 'step'), [entries])
  const latestStep = steps.at(-1)
  const latestPhase = groups.at(-1)?.label
  const [openPhases, setOpenPhases] = useState<Set<string>>(new Set())
  const lastPhase = useRef<string | undefined>(undefined)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const running = turn?.status === 'running'
  const failed = turn?.status === 'failed'
  const terminal = Boolean(turn && ['done', 'skipped', 'failed', 'cancelled'].includes(turn.status))
  const current = useMemo(() => {
    if (!events.length) return { verb: 'No activity yet', object: '', objectIsCode: false, icon: 'tool' as ActivityIcon }
    if (terminal && latestStep) return { verb: `${failed ? 'Failed' : 'Done'} · ${lowerFirst(latestStep.verb)}`, object: latestStep.object, objectIsCode: latestStep.objectIsCode, icon: failed ? 'tool' as ActivityIcon : 'tool' as ActivityIcon }
    if (terminal) return { verb: failed ? 'Failed' : 'Done', object: '', objectIsCode: false, icon: 'tool' as ActivityIcon }
    if (latestStep) return latestStep
    return { verb: latestPhase ?? 'Working', object: '', objectIsCode: false, icon: 'tool' as ActivityIcon }
  }, [events.length, failed, latestPhase, latestStep, terminal])
  const currentKey = `${current.verb}:${current.object}:${current.objectIsCode}`
  const [shownCurrent, setShownCurrent] = useState(current)
  const [swapping, setSwapping] = useState(false)
  const [now, setNow] = useState(0)

  useEffect(() => {
    const next = groups.at(-1)?.id
    if (!next) return
    setOpenPhases((currentOpen) => {
      const updated = new Set(currentOpen)
      if (lastPhase.current && lastPhase.current !== next) updated.delete(lastPhase.current)
      updated.add(next)
      return updated
    })
    lastPhase.current = next
  }, [groups.at(-1)?.id])

  useEffect(() => {
    if (`${shownCurrent.verb}:${shownCurrent.object}:${shownCurrent.objectIsCode}` === currentKey) return
    setSwapping(true)
    const timer = setTimeout(() => { setShownCurrent(current); setSwapping(false) }, 160)
    return () => clearTimeout(timer)
  }, [current, currentKey, shownCurrent])

  useEffect(() => {
    if (!running) { setNow(Date.now()); return }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  useEffect(() => {
    const node = list.current
    if (!node || !atBottom.current) return
    const frame = requestAnimationFrame(() => { node.scrollTop = node.scrollHeight })
    return () => cancelAnimationFrame(frame)
  }, [steps.length])

  useEffect(() => {
    if (!open) return
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setInstant(true)
      onOpenChange(false)
      requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)))
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onOpenChange, open])

  const hasActivity = Boolean(turn || events.length)
  if (!hasActivity && !leaseControls) return null

  const elapsedStart = Date.parse(turn?.startedAt ?? entries[0]?.event.createdAt ?? new Date(now).toISOString())
  const elapsedEnd = turn?.finishedAt ? Date.parse(turn.finishedAt) : now
  const elapsed = formatElapsed(elapsedEnd - elapsedStart)
  const totalLog = groups.flatMap((group) => [group.label, ...group.steps.map(logText)]).join('\n\n')
  const toggle = (detail: number) => {
    if (!events.length) return
    if (detail === 0) {
      setInstant(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)))
    }
    onOpenChange(!open)
  }
  const Icon = terminal && !failed ? Check : icons[shownCurrent.icon]

  return <div className="activity-layer" data-open={open} data-running={running} data-instant={instant}>
    <div className="activity-bottom-bar">
      {hasActivity && <button type="button" className="activity-pill" aria-expanded={events.length ? open : false} aria-controls={drawerId} aria-label="Activity" disabled={!events.length} onClick={(event) => toggle(event.detail)}>
        <span className="activity-pill-icon" aria-hidden="true"><Icon size={13} /></span>
        <span className="activity-current"><span className="activity-current-swap" data-out={swapping}><span className="activity-current-verb">{shownCurrent.verb}</span>{shownCurrent.objectIsCode ? <code>{shownCurrent.object}</code> : shownCurrent.object && <span>{shownCurrent.object}</span>}</span></span>
        <span className="activity-pill-meta">· {steps.length} {steps.length === 1 ? 'step' : 'steps'}{latestPhase ? ` · ${latestPhase}` : ''}</span>
        <ChevronDown className="activity-pill-chevron" size={12} aria-hidden="true" />
      </button>}
      {leaseControls && <div className="activity-lease-shell">{leaseControls}</div>}
    </div>

    {hasActivity && <section id={drawerId} className="activity-drawer" role="region" aria-label="Activity" aria-hidden={!open}>
      <header className="activity-drawer-head">
        <div className="activity-drawer-row">
          <strong>Activity</strong>
          <span>{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span>
          <span className="activity-drawer-spacer" />
          <span className="activity-live" data-status={failed ? 'fail' : running ? 'working' : 'done'}>{running && <i />}{!running && (failed ? <X size={12} /> : <Check size={12} />)}{running ? 'working' : failed ? 'failed' : 'done'} · {elapsed}</span>
          <button type="button" className="activity-head-button" onClick={() => void copy(totalLog)}><Copy size={12} />Copy log</button>
          <button type="button" className="activity-head-button activity-close" aria-label="Close activity" onClick={(event) => toggle(event.detail)}><ChevronDown size={14} /></button>
        </div>
        <div className="activity-progress" />
      </header>
      <div ref={list} className="activity-list" onScroll={(event) => { const node = event.currentTarget; atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 28 }}>
        {groups.map((group) => <Phase key={group.id} group={group} open={openPhases.has(group.id)} onToggle={() => setOpenPhases((currentOpen) => { const updated = new Set(currentOpen); if (updated.has(group.id)) updated.delete(group.id); else updated.add(group.id); return updated })} />)}
        {openTasks && <section className="activity-phase activity-tasks" data-open={tasksOpen}>
          <button type="button" className="activity-phase-header" aria-expanded={tasksOpen} onClick={() => setTasksOpen((value) => !value)}><ChevronDown size={12} /><span>Open tasks</span></button>
          <div className="activity-phase-body"><div>{openTasks}</div></div>
        </section>}
      </div>
    </section>}
  </div>
}
