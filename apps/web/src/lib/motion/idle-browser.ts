import { createIdleMotion, createIdleMotionController, IDLE_BODY_HALF_WIDTH_PX, IDLE_PERSONALITIES, type IdleAnimation, type IdleMotion, type IdlePersonality, type IdleScheduler } from './idle'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const DIALOG_SELECTOR = '[role="dialog"],[aria-modal="true"]'

type MotionElement = HTMLElement | SVGElement
type StopObserving = () => void

export interface IdleBrowserEnvironment {
  rootEvents: EventTarget
  documentEvents: EventTarget
  reducedMotionEvents: EventTarget
  isDocumentVisible: () => boolean
  isReducedMotion: () => boolean
  scopedSelectionActive: () => boolean | null
  isAttentionBlocked: () => boolean
  observeIntersection: (onChange: (visible: boolean) => void) => StopObserving
  observeAttention: (onChange: () => void) => StopObserving
  observeResize: (onChange: () => void) => StopObserving
  schedule: IdleScheduler
  random: () => number
  startMotion: (motion: IdleMotion) => IdleAnimation | null
  resetNeutral: () => void
}

export interface IdleMotionHandle { play: () => void; dispose: () => void }

export function createIdleBrowserBridge({ identity, personality, preview = false, environment }: { identity: string; personality: IdlePersonality; preview?: boolean; environment: IdleBrowserEnvironment }): IdleMotionHandle {
  let disposed = false, visible = false, composing = false, selectionActive = environment.scopedSelectionActive() === true, playRequested = false
  const pointers = new Set<number>()
  const controller = createIdleMotionController({ personality, schedule: environment.schedule, random: environment.random, startMotion: environment.startMotion, resetNeutral: environment.resetNeutral })
  const canMove = () => visible && environment.isDocumentVisible() && !environment.isReducedMotion() && (preview || (!environment.isAttentionBlocked() && pointers.size === 0 && !composing && !selectionActive))
  const refresh = () => { if (!disposed) controller.update({ eligible: canMove(), identity }) }
  const activity = () => { if (!disposed && !preview) controller.activity() }
  const pointerId = (event: Event) => typeof (event as PointerEvent).pointerId === 'number' ? (event as PointerEvent).pointerId : null
  const pointerDown = (event: Event) => { const id = pointerId(event); if (id === null) return; pointers.add(id); activity(); refresh() }
  const pointerMove = (event: Event) => { const id = pointerId(event); if (id !== null && pointers.has(id)) activity() }
  const pointerEnd = (event: Event) => { const id = pointerId(event); if (id === null || !pointers.delete(id)) return; activity(); refresh() }
  const compositionStart = () => { composing = true; activity(); refresh() }
  const compositionEnd = () => { composing = false; activity(); refresh() }
  const selectStart = () => { selectionActive = true; activity(); refresh() }
  const selectionChange = () => { const next = environment.scopedSelectionActive(); if (next === null) { if (selectionActive) { selectionActive = false; refresh() }; return } if (next === selectionActive) { if (selectionActive) activity(); return } selectionActive = next; activity(); refresh() }
  const visibilityChange = () => { if (!environment.isDocumentVisible()) { pointers.clear(); composing = false }; refresh() }
  const simpleActivity = () => activity()
  const rootListeners: ReadonlyArray<readonly [string, EventListener, boolean?]> = [['input', simpleActivity], ['keydown', simpleActivity], ['focusin', simpleActivity], ['scroll', simpleActivity, true], ['pointerdown', pointerDown, true], ['pointermove', pointerMove, true], ['compositionstart', compositionStart], ['compositionupdate', simpleActivity], ['compositionend', compositionEnd], ['selectstart', selectStart], ['select', selectionChange]]
  const documentListeners: ReadonlyArray<readonly [string, EventListener]> = [['visibilitychange', visibilityChange], ['selectionchange', selectionChange], ['pointermove', pointerMove], ['pointerup', pointerEnd], ['pointercancel', pointerEnd]]
  if (!preview) {
    for (const [type, listener, capture] of rootListeners) environment.rootEvents.addEventListener(type, listener, capture)
    for (const [type, listener] of documentListeners) environment.documentEvents.addEventListener(type, listener, true)
  } else environment.documentEvents.addEventListener('visibilitychange', visibilityChange)
  environment.reducedMotionEvents.addEventListener('change', refresh)
  const stopIntersection = environment.observeIntersection((next) => { visible = next; refresh(); if (playRequested && canMove()) { playRequested = false; controller.play() } })
  const stopAttention = preview ? () => {} : environment.observeAttention(refresh)
  const stopResize = environment.observeResize(simpleActivity)
  refresh()
  return {
    play: () => { if (canMove()) controller.play(); else playRequested = true },
    dispose() {
      if (disposed) return
      disposed = true
      if (!preview) {
        for (const [type, listener, capture] of rootListeners) environment.rootEvents.removeEventListener(type, listener, capture)
        for (const [type, listener] of documentListeners) environment.documentEvents.removeEventListener(type, listener, true)
      } else environment.documentEvents.removeEventListener('visibilitychange', visibilityChange)
      environment.reducedMotionEvents.removeEventListener('change', refresh)
      stopIntersection(); stopAttention(); stopResize(); controller.dispose()
    },
  }
}

export function scopedSelectionActive(ownerDocument: Document, interactionRoot: HTMLElement): boolean | null {
  const active = ownerDocument.activeElement as (Element & { selectionStart?: number | null; selectionEnd?: number | null }) | null
  if (active && interactionRoot.contains(active) && typeof active.selectionStart === 'number' && typeof active.selectionEnd === 'number' && active.selectionStart !== active.selectionEnd) return true
  const selection = ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  let scoped = false
  for (let index = 0; index < selection.rangeCount; index += 1) { try { if (selection.getRangeAt(index).intersectsNode(interactionRoot)) { scoped = true; break } } catch { /* detached selection */ } }
  if (!scoped) scoped = Boolean((selection.anchorNode && interactionRoot.contains(selection.anchorNode)) || (selection.focusNode && interactionRoot.contains(selection.focusNode)))
  return scoped ? !selection.isCollapsed : null
}

export function attachIdleMotion({ element, faceElement, shadowElement, stage, viewport, interactionRoot, identity, personality, preview = false }: { element: HTMLElement; faceElement?: MotionElement | null; shadowElement?: HTMLElement | null; stage: HTMLElement; viewport: HTMLElement; interactionRoot: HTMLElement; identity: string; personality: IdlePersonality; preview?: boolean }): IdleMotionHandle {
  const ownerDocument = element.ownerDocument, browserWindow = ownerDocument.defaultView
  const layers = [element, faceElement, shadowElement].filter((item): item is MotionElement => Boolean(item))
  const resetNeutral = () => { for (const layer of layers) { layer.style.removeProperty('transform'); layer.style.removeProperty('transform-origin'); layer.style.removeProperty('opacity') }; element.removeAttribute('data-idle-motion') }
  if (!browserWindow || typeof browserWindow.IntersectionObserver !== 'function' || typeof browserWindow.matchMedia !== 'function' || layers.some((layer) => typeof layer.animate !== 'function')) { resetNeutral(); return { play() {}, dispose: resetNeutral } }
  const reducedMotion = browserWindow.matchMedia(REDUCED_MOTION_QUERY)
  const schedule: IdleScheduler = (callback, delay) => { const timer = browserWindow.setTimeout(callback, delay); return () => browserWindow.clearTimeout(timer) }
  const observeIntersection = (onChange: (visible: boolean) => void) => { const observer = new browserWindow.IntersectionObserver((entries) => { const entry = entries.at(-1); onChange(Boolean(entry?.isIntersecting && (preview || entry.intersectionRatio >= 1))) }, { root: preview ? null : viewport, rootMargin: '0px', threshold: preview ? .01 : 1 }); observer.observe(stage); return () => observer.disconnect() }
  const observeAttention = (onChange: () => void) => {
    if (typeof browserWindow.MutationObserver !== 'function') return () => {}
    const observer = new browserWindow.MutationObserver(onChange), options: MutationObserverInit = { attributes: true, attributeFilter: ['aria-modal', 'role'], childList: true, subtree: true }
    observer.observe(interactionRoot, options)
    if (ownerDocument.body !== interactionRoot) observer.observe(ownerDocument.body, options)
    return () => observer.disconnect()
  }
  const observeResize = (onChange: () => void) => { if (typeof browserWindow.ResizeObserver !== 'function') return () => {}; const observer = new browserWindow.ResizeObserver(onChange); observer.observe(stage); observer.observe(viewport); return () => observer.disconnect() }
  const startMotion = (motion: IdleMotion): IdleAnimation | null => {
    const animations: Animation[] = []
    const cancel = () => { let failed = false; for (const animation of animations) { void animation.finished.catch(() => {}); try { animation.cancel() } catch { failed = true } }; if (failed) throw new Error('Idle animation cancellation failed') }
    try {
      const travel = Math.min(IDLE_PERSONALITIES[personality].travel, Math.max(0, stage.getBoundingClientRect().width / 2 - IDLE_BODY_HALF_WIDTH_PX))
      const bounded = createIdleMotion(motion.kind, motion.direction, personality, travel)
      element.setAttribute('data-idle-motion', motion.kind); element.style.transformOrigin = bounded.transformOrigin
      const options: KeyframeAnimationOptions = { duration: bounded.durationMs, easing: bounded.easing }
      animations.push(element.animate(Array.from(bounded.keyframes) as unknown as Keyframe[], options))
      if (faceElement) animations.push(faceElement.animate(Array.from(bounded.faceKeyframes) as unknown as Keyframe[], options))
      if (shadowElement) animations.push(shadowElement.animate(Array.from(bounded.shadowKeyframes) as unknown as Keyframe[], options))
      return { finished: Promise.all(animations.map((animation) => animation.finished)).catch((error: unknown) => { cancel(); throw error }), cancel }
    } catch { try { cancel() } finally { resetNeutral() }; return null }
  }
  return createIdleBrowserBridge({ identity, personality, preview, environment: {
    rootEvents: interactionRoot, documentEvents: ownerDocument, reducedMotionEvents: reducedMotion,
    isDocumentVisible: () => ownerDocument.visibilityState === 'visible', isReducedMotion: () => reducedMotion.matches,
    scopedSelectionActive: () => scopedSelectionActive(ownerDocument, interactionRoot),
    isAttentionBlocked: () => interactionRoot.matches(DIALOG_SELECTOR) || interactionRoot.querySelector(DIALOG_SELECTOR) !== null || ownerDocument.body.querySelector(DIALOG_SELECTOR) !== null,
    observeIntersection, observeAttention, observeResize, schedule, random: () => browserWindow.Math.random(), startMotion, resetNeutral,
  } })
}
