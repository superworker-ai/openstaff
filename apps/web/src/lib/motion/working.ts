export const WORKING_TYPING_CADENCE_MS = 240
export const WORKING_TYPING_PAIRS = 7
export const WORKING_TYPING_REST_MS = 360
export const WORKING_LOOK_BACK_MS = 1_800
export const WORKING_CHAIR_WIGGLE_MS = 1_500
export const WORKING_CHAIR_WIGGLE_DEG = 7
export const WORKING_FURIOUS_CADENCE_MS = WORKING_TYPING_CADENCE_MS * .65
export const WORKING_FURIOUS_PAIRS = 14
export const WORKING_FIRST_QUIRK_MIN_MS = 2_800
export const WORKING_FIRST_QUIRK_MAX_MS = 3_200
export const WORKING_QUIRK_MIN_MS = 7_600
export const WORKING_QUIRK_MAX_MS = 8_400

const INITIAL_DELAY_MAX_MS = 400
const QUIRK_REST_MS = 300
const FURIOUS_REST_MS = 600
const MOTION_EASING = 'cubic-bezier(.65,0,.35,1)'

export type WorkingMotionKind = 'typing' | 'look-back' | 'chair-wiggle' | 'furious-typing'
export type WorkingQuirkKind = Exclude<WorkingMotionKind, 'typing'>
export type WorkingPart = 'body' | 'screen-lines'
export interface WorkingKeyframe { transform?: string; opacity?: number; offset?: number }
export interface WorkingMotionTrack { part: WorkingPart; durationMs: number; iterations: number; easing?: string; keyframes: ReadonlyArray<WorkingKeyframe> }
export interface WorkingMotion { kind: WorkingMotionKind; durationMs: number; restMs: number; easing: string; tracks: ReadonlyArray<WorkingMotionTrack> }
export interface WorkingTiming { initialDelayMs: number; firstQuirkAtMs: number; quirkSpacingMs: number; quirkOrder: readonly [WorkingQuirkKind, WorkingQuirkKind, WorkingQuirkKind] }
export interface WorkingAnimation { finished: Promise<unknown>; cancel: () => void }
export type WorkingScheduler = (callback: () => void, delayMs: number) => () => void
export interface WorkingMotionController { update: (state: { active: boolean; identity: string | null }) => void; dispose: () => void }

const BASE_QUIRK_ORDER: readonly [WorkingQuirkKind, WorkingQuirkKind, WorkingQuirkKind] = ['look-back', 'chair-wiggle', 'furious-typing']

function typingMotion(furious: boolean): WorkingMotion {
  const cadenceMs = furious ? WORKING_FURIOUS_CADENCE_MS : WORKING_TYPING_CADENCE_MS
  const iterations = furious ? WORKING_FURIOUS_PAIRS : WORKING_TYPING_PAIRS
  const durationMs = cadenceMs * iterations, trackDurationMs = furious ? cadenceMs : durationMs, trackIterations = furious ? iterations : 1
  return {
    kind: furious ? 'furious-typing' : 'typing', durationMs, restMs: furious ? FURIOUS_REST_MS : WORKING_TYPING_REST_MS, easing: MOTION_EASING,
    tracks: [
      { part: 'body', durationMs: trackDurationMs, iterations: trackIterations, keyframes: [{ transform: 'rotate(-2.1deg) translateY(0)' }, { transform: 'rotate(2.1deg) translateY(-1px)' }, { transform: 'rotate(-2.1deg) translateY(0)' }] },
      { part: 'screen-lines', durationMs: trackDurationMs, iterations: trackIterations, easing: 'steps(2)', keyframes: [{ opacity: 1 }, { opacity: .35 }, { opacity: 1 }] },
    ],
  }
}

function lookBackMotion(): WorkingMotion {
  return { kind: 'look-back', durationMs: WORKING_LOOK_BACK_MS, restMs: QUIRK_REST_MS, easing: MOTION_EASING, tracks: [
    { part: 'body', durationMs: WORKING_LOOK_BACK_MS, iterations: 1, keyframes: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-14deg) translateX(-3px)', offset: .3 }, { transform: 'rotate(-14deg) translateX(-3px)', offset: .72 }, { transform: 'rotate(0deg)' }] },
  ] }
}

const rounded = (value: number) => Math.round(value * 100) / 100
function chairWiggleMotion(): WorkingMotion {
  const poses = [0, -1, 1, -.8, .7, -.4, 0]
  return { kind: 'chair-wiggle', durationMs: WORKING_CHAIR_WIGGLE_MS, restMs: QUIRK_REST_MS, easing: MOTION_EASING, tracks: [
    { part: 'body', durationMs: WORKING_CHAIR_WIGGLE_MS, iterations: 1, keyframes: poses.map((pose) => ({ transform: `rotate(${rounded(pose * WORKING_CHAIR_WIGGLE_DEG)}deg) translateY(${rounded(-Math.abs(pose) * 2)}px)` })) },
  ] }
}

export function createWorkingMotion(kind: WorkingMotionKind): WorkingMotion {
  if (kind === 'typing') return typingMotion(false)
  if (kind === 'furious-typing') return typingMotion(true)
  if (kind === 'look-back') return lookBackMotion()
  return chairWiggleMotion()
}

function stableHash(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16_777_619) }
  return hash >>> 0
}
const identitySample = (identity: string, salt: string) => stableHash(`${identity}:${salt}`) / 4_294_967_295
const sampledInteger = (identity: string, salt: string, minimum: number, maximum: number) => minimum + Math.round(identitySample(identity, salt) * (maximum - minimum))

export function createWorkingTiming(identity: string): WorkingTiming {
  const start = sampledInteger(identity, 'quirk-order', 0, 2)
  const quirkOrder = BASE_QUIRK_ORDER.map((_, index) => BASE_QUIRK_ORDER[(start + index) % 3]) as [WorkingQuirkKind, WorkingQuirkKind, WorkingQuirkKind]
  return { initialDelayMs: sampledInteger(identity, 'phase', 0, INITIAL_DELAY_MAX_MS), firstQuirkAtMs: sampledInteger(identity, 'first-quirk', WORKING_FIRST_QUIRK_MIN_MS, WORKING_FIRST_QUIRK_MAX_MS), quirkSpacingMs: sampledInteger(identity, 'quirk-spacing', WORKING_QUIRK_MIN_MS, WORKING_QUIRK_MAX_MS), quirkOrder }
}

export function createWorkingMotionController({ schedule, startMotion, resetNeutral }: { schedule: WorkingScheduler; startMotion: (motion: WorkingMotion) => WorkingAnimation | null; resetNeutral: () => void }): WorkingMotionController {
  let active = false, identity: string | null = null, disposed = false, supported = true, generation = 0, elapsedMs = 0, nextQuirkAtMs = 0, quirkIndex = 0
  let timing: WorkingTiming | null = null, cancelDeadline: (() => void) | null = null, activeAnimation: WorkingAnimation | null = null
  const cancelCurrentWork = () => { generation += 1; cancelDeadline?.(); cancelDeadline = null; const animation = activeAnimation; activeAnimation = null; if (animation) { try { animation.cancel() } catch { supported = false } }; resetNeutral() }
  const canRun = () => !disposed && active && identity !== null && supported && timing !== null
  const scheduleCycle = (delayMs: number) => {
    if (!canRun()) return
    cancelDeadline?.(); const scheduledGeneration = generation; let scheduledCancel: (() => void) | null = null
    const deadline = () => { if (cancelDeadline !== scheduledCancel || scheduledGeneration !== generation || !canRun()) return; cancelDeadline = null; elapsedMs += delayMs; runCycle() }
    scheduledCancel = schedule(deadline, delayMs); cancelDeadline = scheduledCancel
  }
  const beginMotion = (motion: WorkingMotion) => {
    if (!canRun()) return
    let animation: WorkingAnimation | null
    try { animation = startMotion(motion) } catch { supported = false; resetNeutral(); return }
    if (!animation) { supported = false; resetNeutral(); return }
    activeAnimation = animation; const animationGeneration = generation
    void animation.finished.then(() => { if (activeAnimation !== animation || animationGeneration !== generation || !canRun()) return; activeAnimation = null; elapsedMs += motion.durationMs; resetNeutral(); scheduleCycle(Math.min(motion.restMs, Math.max(0, nextQuirkAtMs - elapsedMs))) }, () => { if (activeAnimation !== animation || animationGeneration !== generation) return; activeAnimation = null; supported = false; resetNeutral() })
  }
  function runCycle() {
    if (!canRun() || !timing) return
    if (elapsedMs >= nextQuirkAtMs) { const kind = timing.quirkOrder[quirkIndex % timing.quirkOrder.length]!; quirkIndex += 1; nextQuirkAtMs = elapsedMs + timing.quirkSpacingMs; beginMotion(createWorkingMotion(kind)); return }
    const typing = createWorkingMotion('typing')
    if (elapsedMs + typing.durationMs + typing.restMs > nextQuirkAtMs) { scheduleCycle(nextQuirkAtMs - elapsedMs); return }
    beginMotion(typing)
  }
  return {
    update(next) { if (disposed) return; const identityChanged = next.identity !== identity, activeChanged = next.active !== active; if (!identityChanged && !activeChanged) return; cancelCurrentWork(); identity = next.identity; active = next.active; if (!active || identity === null) { timing = null; return }; supported = true; elapsedMs = 0; quirkIndex = 0; timing = createWorkingTiming(identity); nextQuirkAtMs = timing.firstQuirkAtMs; scheduleCycle(timing.initialDelayMs) },
    dispose() { if (disposed) return; disposed = true; cancelCurrentWork() },
  }
}
