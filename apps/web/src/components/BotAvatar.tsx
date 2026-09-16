import type { CSSProperties } from 'react'
import { resolveAvatar, type Avatar, type ResolvedAvatar } from '@openstaff/shared'

interface Props extends Avatar {
  size?: number
  label?: string
  animate?: boolean
}

const ANCHORS: Record<Avatar['shape'], { cx: number; cy: number; scale: number; top: number }> = {
  circle: { cx: 24, cy: 24, scale: 1, top: 4 },
  triangle: { cx: 24, cy: 31, scale: .8, top: 4 },
  drop: { cx: 24, cy: 31, scale: .85, top: 3 },
  hex: { cx: 24, cy: 24, scale: 1, top: 3 },
  blob: { cx: 24, cy: 24, scale: 1, top: 3 },
}

function stableHash(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16_777_619) }
  return hash >>> 0
}

function Body({ shape, color }: Pick<ResolvedAvatar, 'shape' | 'color'>) {
  return <g data-part="body-shape">{shape === 'circle' && <circle cx="24" cy="24" r="20" fill={color} />}{shape === 'triangle' && <path d="M24 4 45 42H3Z" fill={color} />}{shape === 'drop' && <path d="M24 3C18 13 7 23 7 32a17 17 0 0 0 34 0C41 23 30 13 24 3Z" fill={color} />}{shape === 'hex' && <path d="m24 3 19 11v20L24 45 5 34V14Z" fill={color} />}{shape === 'blob' && <path d="M39 8c7 7 4 18 0 27-4 9-14 12-23 9C7 41 1 32 4 23 7 14 12 4 22 3c6-1 12 1 17 5Z" fill={color} />}</g>
}

function Eyes({ eyes }: Pick<ResolvedAvatar, 'eyes'>) {
  if (eyes === 'round') return <><circle cx="-7" cy="-2" r="4" fill="#fff" /><circle cx="7" cy="-2" r="4" fill="#fff" /><circle cx="-7" cy="-2" r="1.6" fill="#18181b" /><circle cx="7" cy="-2" r="1.6" fill="#18181b" /></>
  if (eyes === 'happy') return <><path d="M-11 0Q-7-5-3 0" /><path d="M3 0Q7-5 11 0" /></>
  if (eyes === 'sleepy') return <><path d="M-11-1Q-7 1-3-1" /><path d="M3-1Q7 1 11-1" /></>
  if (eyes === 'wink') return <><circle cx="-7" cy="-2" r="2.5" fill="#fff" stroke="none" /><path d="M3 0Q7-5 11 0" /></>
  return <><circle cx="-7" cy="-2" r="2.5" fill="#fff" stroke="none" /><circle cx="7" cy="-2" r="2.5" fill="#fff" stroke="none" /></>
}

function Mouth({ mouth }: Pick<ResolvedAvatar, 'mouth'>) {
  if (mouth === 'none') return null
  if (mouth === 'grin') return <path d="M-7 6Q0 15 7 6Z" fill="#fff" stroke="none" />
  if (mouth === 'flat') return <path d="M-6 8H6" />
  if (mouth === 'open') return <ellipse cx="0" cy="9" rx="4" ry="5" fill="#fff" stroke="none" />
  return <path d="M-7 6Q0 13 7 6" />
}

function Accessory({ accessory, anchor }: { accessory: ResolvedAvatar['accessory']; anchor: (typeof ANCHORS)[Avatar['shape']] }) {
  if (accessory === 'none') return null
  if (accessory === 'glasses') return <g transform={`translate(${anchor.cx} ${anchor.cy}) scale(${anchor.scale})`}><circle cx="-7" cy="-2" r="6" /><circle cx="7" cy="-2" r="6" /><path d="M-1-2H1" /></g>
  if (accessory === 'headphones') return <g transform={`translate(${anchor.cx} ${anchor.top})`}><path d="M-16 18Q-16 1 0 1Q16 1 16 18" /><rect x="-19" y="15" width="6" height="11" rx="3" fill="#fff" stroke="none" /><rect x="13" y="15" width="6" height="11" rx="3" fill="#fff" stroke="none" /></g>
  if (accessory === 'antenna') return <g transform={`translate(${anchor.cx} ${anchor.top + 5})`}><path d="M0 3V-2" /><circle cy="-4" r="3" fill="#fff" stroke="none" /></g>
  if (accessory === 'bow') return <g transform={`translate(${anchor.cx} ${anchor.top + 4})`}><path d="M0 0C-5-5-10-4-9 2C-8 7-4 5 0 2C4 5 8 7 9 2C10-4 5-5 0 0Z" fill="#fff" stroke="none" /><circle cy="1" r="2" fill="#18181b" stroke="none" /></g>
  return <g transform={`translate(${anchor.cx} ${anchor.top + 7})`}><path d="M-11 0Q0-11 11 0Z" fill="#fff" stroke="none" /><path d="M-13 1H14" /></g>
}

export function BotAvatar({ shape, color, eyes, mouth, accessory, personality, size = 36, label, animate = false }: Props) {
  const avatar = resolveAvatar({ shape, color, eyes, mouth, accessory, personality })
  const anchor = ANCHORS[shape]
  const canBlink = !['happy', 'sleepy', 'wink'].includes(avatar.eyes)
  const delay = -((stableHash(label ?? `${shape}:${color}`) % 5_200) / 1_000)
  const style = { '--bot-blink-delay': `${delay}s` } as CSSProperties
  return <svg data-slot="bot-avatar" data-shape={shape} data-eyes={avatar.eyes} data-mouth={avatar.mouth} data-accessory={avatar.accessory} data-personality={avatar.personality} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={label ?? `${shape} avatar`} className={`shrink-0 ${animate ? 'bot-avatar-live' : ''}`} style={style}><g data-part="character"><Body shape={shape} color={color} /><g data-part="face" transform={`translate(${anchor.cx} ${anchor.cy}) scale(${anchor.scale})`} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><g data-part="face-motion"><g data-part="eyes" data-blink={canBlink ? 'true' : 'false'}><Eyes eyes={avatar.eyes} /></g><g data-part="mouth"><Mouth mouth={avatar.mouth} /></g></g></g><g data-part="accessory" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><Accessory accessory={avatar.accessory} anchor={anchor} /></g></g></svg>
}

export function HumanAvatar({ name, size = 36 }: { name: string; size?: number }) {
  return <div style={{ width: size, height: size }} className="human-avatar grid shrink-0 place-items-center rounded-full bg-surface-4 text-xs font-semibold text-fg-muted">{name.slice(0, 2).toUpperCase()}</div>
}
