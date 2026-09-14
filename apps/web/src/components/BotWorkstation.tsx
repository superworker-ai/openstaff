import { useEffect, useId, useRef } from 'react'
import { resolveAvatar, type Avatar } from '@openstaff/shared'
import { attachWorkingMotion } from '../lib/motion/working-browser'

interface Props extends Avatar {
  size: number
  state: 'working' | 'waiting'
  label?: string
  identity: string
}

const PER_SHAPE: Record<Avatar['shape'], string> = {
  triangle: 'translate(3 8) scale(.88)',
  drop: 'translate(6 10) scale(.76)',
  circle: 'translate(8.5 13) scale(.64)',
  hex: 'translate(8 12.5) scale(.66)',
  blob: 'translate(8 12.5) scale(.66)',
}

function RearShape({ shape, fill }: { shape: Avatar['shape']; fill: string }) {
  if (shape === 'circle') return <circle cx="24" cy="24" r="20" fill={fill} />
  if (shape === 'triangle') return <path d="M24 4 45 42H3Z" fill={fill} />
  if (shape === 'drop') return <path d="M24 3C18 13 7 23 7 32a17 17 0 0 0 34 0C41 23 30 13 24 3Z" fill={fill} />
  if (shape === 'hex') return <path d="m24 3 19 11v20L24 45 5 34V14Z" fill={fill} />
  return <path d="M39 8c7 7 4 18 0 27-4 9-14 12-23 9C7 41 1 32 4 23 7 14 12 4 22 3c6-1 12 1 17 5Z" fill={fill} />
}

export function BotWorkstation({ shape, color, eyes, mouth, accessory, personality, size, state, label, identity }: Props) {
  const avatar = resolveAvatar({ shape, color, eyes, mouth, accessory, personality })
  const root = useRef<SVGSVGElement>(null)
  const clip = `bot-back-${useId().replaceAll(':', '')}`
  useEffect(() => { if (root.current) return attachWorkingMotion({ root: root.current, state, identity }) }, [identity, state])
  return <svg ref={root} data-slot="bot-workstation" data-state={state} data-shape={avatar.shape} viewBox="0 0 48 48" width={size} height={size} overflow="visible" role="img" aria-label={label ?? `${state} bot`} className="shrink-0"><defs><clipPath id={clip}><RearShape shape={avatar.shape} fill="#000" /></clipPath></defs>
    <rect x="9" y="1" width="30" height="20" rx="2" fill="#71717a" stroke="#18181b" strokeWidth="1.6" />
    <rect x="12" y="4" width="24" height="14" rx="1" fill="#fff" opacity=".9" />
    <g data-part="screen-dots"><circle cx="15.5" cy="7" r="1.3" fill="#F04438" /><circle cx="19" cy="7" r="1.3" fill="#F79009" /><circle cx="22.5" cy="7" r="1.3" fill="#12B76A" /></g>
    <path data-part="screen-lines" d="M15 11H27M15 14H23" stroke="#a1a1aa" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    <path d="M24 21V27M16 27H32M2 31H46" fill="none" stroke="#18181b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <g transform={PER_SHAPE[avatar.shape]}><g data-part="body"><RearShape shape={avatar.shape} fill={avatar.color} /><g clipPath={`url(#${clip})`}><rect x="0" y="0" width="17" height="48" fill="#18181b" opacity=".16" /></g></g></g>
    {state === 'waiting' && <g transform="translate(24 -4)"><g data-part="alert"><path d="M-2.4 -18H2.4L1.6 -6H-1.6Z" fill="#E0242B" stroke="#18181b" strokeWidth=".8" strokeLinejoin="round" /><circle cy="-1.6" r="2.4" fill="#E0242B" stroke="#18181b" strokeWidth=".8" strokeLinejoin="round" /></g></g>}
  </svg>
}
