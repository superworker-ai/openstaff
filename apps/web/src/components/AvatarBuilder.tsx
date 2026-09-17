import { useEffect, useMemo, useRef, useState } from 'react'
import { BOT_ACCESSORIES, BOT_COLORS, BOT_EYES, BOT_MOUTHS, BOT_PERSONALITIES, BOT_SHAPES, PERSONALITY_META, resolveAvatar, type Avatar, type ResolvedAvatar } from '@openstaff/shared'
import { surpriseAvatar } from '../lib/avatar-surprise'
import { attachIdleMotion, type IdleMotionHandle } from '../lib/motion/idle-browser'
import { BotAvatar } from './BotAvatar'

export function AvatarBuilder({ value, onChange, name, movementLabel = 'Personality' }: { value: Avatar; onChange: (value: Avatar) => void; name?: string; movementLabel?: string }) {
  const avatar = resolveAvatar(value)
  const stage = useRef<HTMLDivElement>(null), body = useRef<HTMLSpanElement>(null), shadow = useRef<HTMLSpanElement>(null), motion = useRef<IdleMotionHandle>(null)
  const [reduced, setReduced] = useState(false)
  const identity = useMemo(() => `${name ?? 'preview'}:${JSON.stringify(avatar)}`, [avatar, name])
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)'), update = () => setReduced(query.matches)
    update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!stage.current || !body.current) return
    const svg = body.current.querySelector('svg')
    const handle = attachIdleMotion({ element: body.current, faceElement: svg?.querySelector<SVGElement>('[data-part="face-motion"]'), shadowElement: shadow.current, stage: stage.current, viewport: stage.current, interactionRoot: stage.current, identity, personality: avatar.personality, preview: true })
    motion.current = handle; handle.play()
    return () => { if (motion.current === handle) motion.current = null; handle.dispose() }
  }, [identity, avatar.personality])
  const change = <K extends keyof ResolvedAvatar>(key: K, next: ResolvedAvatar[K]) => onChange({ ...avatar, [key]: next })
  return <aside className="space-y-5"><div ref={stage} className="bot-builder-stage"><span className="bot-builder-floor" /><span ref={shadow} data-part="shadow" className="bot-builder-shadow" /><span className="bot-builder-anchor"><span ref={body} data-part="body" className="bot-builder-body"><BotAvatar {...avatar} size={56} label={name ?? 'Persona preview'} animate /></span></span></div><div className="flex gap-2"><button type="button" aria-label="Play a move" disabled={reduced} onClick={() => motion.current?.play()} className="flex-1 rounded-md border border-line-strong bg-surface-3 px-3 py-2 text-sm text-fg hover:bg-surface-4">Play a move</button><button type="button" disabled={reduced} onClick={() => onChange(surpriseAvatar(avatar))} className="flex-1 rounded-md border border-line-strong bg-surface-3 px-3 py-2 text-sm text-fg hover:bg-surface-4">Surprise me</button></div>{reduced && <p className="text-xs text-fg-muted">Motion preview is off while reduced motion is enabled.</p>}
    <fieldset><legend className="mb-2 text-xs font-medium text-fg-muted">{movementLabel}</legend><div className="grid grid-cols-2 gap-2">{BOT_PERSONALITIES.map((personality) => <button type="button" key={personality} aria-label={`${movementLabel}: ${PERSONALITY_META[personality].label}`} aria-pressed={avatar.personality === personality} onClick={() => change('personality', personality)} className={`flex items-center gap-2 rounded-md border p-2 text-left ${avatar.personality === personality ? 'border-line-strong bg-surface-3' : 'border-line bg-surface-2'}`}><BotAvatar {...avatar} personality={personality} size={28} /><span><span className="block text-sm font-medium">{PERSONALITY_META[personality].label}</span><span className="mt-1 block text-[11px] leading-4 text-fg-muted">{PERSONALITY_META[personality].description}</span></span></button>)}</div></fieldset>
    <OptionGroup legend="Shape" values={BOT_SHAPES} selected={avatar.shape} label={(item) => `Shape: ${item}`} render={(item) => <BotAvatar {...avatar} shape={item} size={28} />} onSelect={(item) => change('shape', item)} />
    <fieldset><legend className="mb-2 text-xs font-medium text-fg-muted">Color</legend><div className="flex flex-wrap gap-2">{BOT_COLORS.map((color) => <button type="button" key={color} aria-label={`Color: ${color}`} aria-pressed={avatar.color.toLowerCase() === color.toLowerCase()} onClick={() => change('color', color)} className={`rounded-md border p-1.5 ${avatar.color.toLowerCase() === color.toLowerCase() ? 'border-line-strong bg-surface-3' : 'border-line bg-surface-2'}`}><BotAvatar {...avatar} color={color} size={28} /></button>)}<label className={`grid h-[42px] w-[42px] cursor-pointer place-items-center rounded-md border text-[9px] ${!BOT_COLORS.some((color) => color.toLowerCase() === avatar.color.toLowerCase()) ? 'border-line-strong bg-surface-3' : 'border-line bg-surface-2'}`}>Custom<input type="color" aria-label="Custom color" value={avatar.color} onChange={(event) => change('color', event.target.value)} className="sr-only" /></label></div></fieldset>
    <OptionGroup legend="Eyes" values={BOT_EYES} selected={avatar.eyes} label={(item) => `Eyes: ${item}`} render={(item) => <BotAvatar {...avatar} eyes={item} size={28} />} onSelect={(item) => change('eyes', item)} />
    <OptionGroup legend="Mouth" values={BOT_MOUTHS} selected={avatar.mouth} label={(item) => `Mouth: ${item}`} render={(item) => <BotAvatar {...avatar} mouth={item} size={28} />} onSelect={(item) => change('mouth', item)} />
    <OptionGroup legend="Accessory" values={BOT_ACCESSORIES} selected={avatar.accessory} label={(item) => `Accessory: ${item}`} render={(item) => <BotAvatar {...avatar} accessory={item} size={28} />} onSelect={(item) => change('accessory', item)} />
  </aside>
}

function OptionGroup<T extends string>({ legend, values, selected, label, render, onSelect }: { legend: string; values: readonly T[]; selected: T; label: (value: T) => string; render: (value: T) => React.ReactNode; onSelect: (value: T) => void }) {
  return <fieldset><legend className="mb-2 text-xs font-medium text-fg-muted">{legend}</legend><div className="flex flex-wrap gap-2">{values.map((item) => <button type="button" key={item} aria-label={label(item)} aria-pressed={selected === item} onClick={() => onSelect(item)} className={`rounded-md border p-1.5 ${selected === item ? 'border-line-strong bg-surface-3' : 'border-line bg-surface-2'}`}>{render(item)}</button>)}</div></fieldset>
}
