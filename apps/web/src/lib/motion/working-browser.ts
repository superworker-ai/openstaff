import { createWorkingMotionController, type WorkingAnimation, type WorkingMotion, type WorkingPart, type WorkingScheduler } from './working'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
type WorkingState = 'working' | 'waiting'
type StopObserving = () => void

export interface WorkingBrowserEnvironment {
  documentEvents: EventTarget
  reducedMotionEvents: EventTarget
  isDocumentVisible: () => boolean
  isReducedMotion: () => boolean
  observeIntersection: (onChange: (visible: boolean) => void) => StopObserving
  schedule: WorkingScheduler
  startMotion: (motion: WorkingMotion) => WorkingAnimation | null
  resetNeutral: () => void
}

export function createWorkingBrowserBridge({ state, identity, environment }: { state: WorkingState; identity: string; environment: WorkingBrowserEnvironment }): () => void {
  let disposed = false, visible = false
  const controller = createWorkingMotionController({ schedule: environment.schedule, startMotion: environment.startMotion, resetNeutral: environment.resetNeutral })
  const refresh = () => { if (!disposed) controller.update({ active: state === 'working' && visible && environment.isDocumentVisible() && !environment.isReducedMotion(), identity }) }
  environment.documentEvents.addEventListener('visibilitychange', refresh); environment.reducedMotionEvents.addEventListener('change', refresh)
  const stopObserving = environment.observeIntersection((next) => { visible = next; refresh() })
  refresh()
  return () => { if (disposed) return; disposed = true; environment.documentEvents.removeEventListener('visibilitychange', refresh); environment.reducedMotionEvents.removeEventListener('change', refresh); stopObserving(); controller.dispose() }
}

function workstationParts(root: SVGSVGElement): Map<WorkingPart, SVGElement> {
  const parts = new Map<WorkingPart, SVGElement>()
  for (const part of ['body', 'screen-lines'] as const) { const element = root.querySelector<SVGElement>(`[data-part="${part}"]`); if (element) parts.set(part, element) }
  return parts
}

export function attachWorkingMotion({ root, state, identity }: { root: SVGSVGElement; state: WorkingState; identity: string }): () => void {
  const ownerDocument = root.ownerDocument, browserWindow = ownerDocument.defaultView, parts = workstationParts(root)
  const resetNeutral = () => { root.removeAttribute('data-motion'); for (const element of parts.values()) { element.style.removeProperty('transform'); element.style.removeProperty('opacity') } }
  if (state !== 'working' || !browserWindow || typeof browserWindow.IntersectionObserver !== 'function' || typeof browserWindow.matchMedia !== 'function' || [...parts.values()].some((element) => typeof element.animate !== 'function')) { resetNeutral(); return resetNeutral }
  const reducedMotion = browserWindow.matchMedia(REDUCED_MOTION_QUERY)
  const schedule: WorkingScheduler = (callback, delay) => { const timer = browserWindow.setTimeout(callback, delay); return () => browserWindow.clearTimeout(timer) }
  const observeIntersection = (onChange: (visible: boolean) => void) => { const observer = new browserWindow.IntersectionObserver((entries) => onChange(Boolean(entries.at(-1)?.isIntersecting)), { rootMargin: '0px', threshold: .01 }); observer.observe(root); return () => observer.disconnect() }
  const startMotion = (motion: WorkingMotion): WorkingAnimation | null => {
    const animations: Animation[] = []
    const cancel = () => { let failed = false; for (const animation of animations) { void animation.finished.catch(() => {}); try { animation.cancel() } catch { failed = true } }; if (failed) throw new Error('Workstation animation cancellation failed') }
    try {
      root.setAttribute('data-motion', motion.kind)
      for (const track of motion.tracks) { const element = parts.get(track.part); if (!element) throw new Error(`Missing workstation part: ${track.part}`); animations.push(element.animate(Array.from(track.keyframes) as Keyframe[], { duration: track.durationMs, easing: track.easing ?? motion.easing, iterations: track.iterations })) }
      return { finished: Promise.all(animations.map((animation) => animation.finished)).catch((error: unknown) => { cancel(); throw error }), cancel }
    } catch { try { cancel() } finally { resetNeutral() }; return null }
  }
  return createWorkingBrowserBridge({ state, identity, environment: { documentEvents: ownerDocument, reducedMotionEvents: reducedMotion, isDocumentVisible: () => ownerDocument.visibilityState === 'visible', isReducedMotion: () => reducedMotion.matches, observeIntersection, schedule, startMotion, resetNeutral } })
}
