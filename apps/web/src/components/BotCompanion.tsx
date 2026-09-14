import { useEffect, useRef, type RefObject } from 'react'
import { resolveAvatar, type Bot, type Message } from '@openstaff/shared'
import { attachIdleMotion } from '../lib/motion/idle-browser'
import { BotAvatar } from './BotAvatar'

export function BotCompanion({ bot, message, viewportRef, interactionRootRef }: { bot: Bot; message: Message; viewportRef: RefObject<HTMLElement | null>; interactionRootRef: RefObject<HTMLElement | null> }) {
  const stage = useRef<HTMLDivElement>(null), body = useRef<HTMLSpanElement>(null), shadow = useRef<HTMLSpanElement>(null)
  const avatar = resolveAvatar(bot.avatar), identity = `${bot.id}:${message.id}`
  useEffect(() => {
    const element = body.current, stageElement = stage.current, viewport = viewportRef.current, interactionRoot = interactionRootRef.current
    if (!element || !stageElement || !viewport || !interactionRoot) return
    const handle = attachIdleMotion({ element, faceElement: element.querySelector<SVGElement>('[data-part="face-motion"]'), shadowElement: shadow.current, stage: stageElement, viewport, interactionRoot, identity, personality: avatar.personality })
    return handle.dispose
  }, [avatar.personality, identity, interactionRootRef, viewportRef])
  return <div ref={stage} data-slot="bot-companion" className="bot-companion" aria-hidden="true"><span className="bot-companion-anchor"><span ref={shadow} data-part="shadow" className="bot-companion-shadow" /><span ref={body} data-part="body" className="bot-companion-body"><BotAvatar {...avatar} size={28} label={bot.name} animate /></span></span></div>
}
