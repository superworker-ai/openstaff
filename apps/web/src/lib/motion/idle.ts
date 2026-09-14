import type { ResolvedAvatar } from '@openstaff/shared'

export const IDLE_SIZE_PX = 28
export const IDLE_STAGE_HEIGHT_PX = 72
export const IDLE_BODY_HALF_WIDTH_PX = 32

const MOTION_EASING = 'linear'
const RISE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const FALL_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)'
const FALLBACK_RANDOM_SAMPLE = .5

export type IdlePersonality = ResolvedAvatar['personality']
export type IdleMotionKind = 'bounce' | 'double-hop' | 'scoot' | 'wiggle' | 'peek' | 'spin'
export type IdleDirection = -1 | 1
export interface IdleMotionFrame { transform: string; offset: number; easing: string }
export interface IdleFaceFrame { transform: string; offset: number }
export interface IdleShadowFrame { opacity: number; transform: string; offset: number; easing: string }
export interface IdleMotion { kind: IdleMotionKind; direction: IdleDirection; durationMs: number; easing: string; transformOrigin: '50% 100%' | '50% 50%'; keyframes: ReadonlyArray<IdleMotionFrame>; faceKeyframes: ReadonlyArray<IdleFaceFrame>; shadowKeyframes: ReadonlyArray<IdleShadowFrame> }
export interface IdleAnimation { finished: Promise<unknown>; cancel: () => void }
export type IdleScheduler = (callback: () => void, delayMs: number) => () => void
export interface IdleMotionController { update: (state: { eligible: boolean; identity: string | null }) => void; activity: () => void; play: () => void; dispose: () => void }

export const IDLE_PERSONALITIES: Record<IdlePersonality, { jump: number; travel: number; squash: number; tilt: number; baseMs: number; firstWait: readonly [number, number]; rest: readonly [number, number]; kinds: readonly IdleMotionKind[] }> = {
  calm: { jump: 8, travel: 6, squash: .06, tilt: 4, baseMs: 620, firstWait: [3_000, 7_000], rest: [8_000, 14_000], kinds: ['bounce', 'peek'] },
  playful: { jump: 24, travel: 32, squash: .18, tilt: 12, baseMs: 800, firstWait: [2_200, 3_800], rest: [3_800, 6_200], kinds: ['bounce', 'double-hop', 'scoot', 'wiggle', 'peek', 'spin'] },
  curious: { jump: 12, travel: 48, squash: .12, tilt: 22, baseMs: 1_200, firstWait: [2_000, 4_000], rest: [3_900, 8_100], kinds: ['bounce', 'double-hop', 'scoot', 'wiggle', 'peek', 'peek', 'peek', 'spin'] },
  gremlin: { jump: 32, travel: 56, squash: .28, tilt: 24, baseMs: 1_000, firstWait: [1_200, 2_800], rest: [1_800, 4_200], kinds: ['bounce', 'double-hop', 'scoot', 'wiggle', 'peek', 'spin'] },
}

const DURATION_FACTORS: Record<IdleMotionKind, number> = { bounce: 1, 'double-hop': 1.25, scoot: 1.1, wiggle: .9, peek: 1.2, spin: 1.3 }

function boundedRandomSample(random: () => number): number {
  try { const sample = random(); return Number.isFinite(sample) && sample >= 0 && sample <= 1 ? sample : FALLBACK_RANDOM_SAMPLE } catch { return FALLBACK_RANDOM_SAMPLE }
}

function sampledDelay(random: () => number, range: readonly [number, number]): number {
  return range[0] + Math.round(boundedRandomSample(random) * (range[1] - range[0]))
}

const rounded = (value: number) => Math.round(value * 100) / 100

function bodyFrames(kind: IdleMotionKind, direction: IdleDirection, personality: IdlePersonality, maximumTravel: number): ReadonlyArray<IdleMotionFrame> {
  const config = IDLE_PERSONALITIES[personality]
  const q = config.squash, x = direction * maximumTravel, a = direction * config.tilt, h = config.jump
  const pose = (offset: number, dx = 0, dy = 0, angle = 0, scaleX = 1, scaleY = 1, easing = RISE_EASING): IdleMotionFrame => ({ offset, easing, transform: `translate3d(${rounded(dx)}px, ${rounded(dy)}px, 0) rotate(${rounded(angle)}deg) scale(${rounded(scaleX)}, ${rounded(scaleY)})` })
  const start = pose(0), end = pose(1)
  if (kind === 'bounce') return [start, pose(.12, 0, 0, -a * .2, 1 + q, 1 - q), pose(.34, 0, -h, a * .45, 1 - q * .45, 1 + q * .45, FALL_EASING), pose(.66, 0, 0, 0, 1 + q, 1 - q), pose(.81, 0, -h * .18, -a * .15, 1 - q * .15, 1 + q * .15, FALL_EASING), end]
  if (kind === 'double-hop') return [start, pose(.09, 0, 0, 0, 1 + q, 1 - q), pose(.24, -x * .12, -h * .65, -a * .45, 1 - q * .3, 1 + q * .3, FALL_EASING), pose(.4, 0, 0, 0, 1 + q, 1 - q), pose(.61, x * .2, -h, a * .65, 1 - q * .4, 1 + q * .4, FALL_EASING), pose(.83, 0, 0, 0, 1 + q * .8, 1 - q * .8), end]
  if (kind === 'scoot') return [start, pose(.13, -x * .12, 0, -a * .6, 1 + q * .5, 1 - q * .5), pose(.4, x, -h * .22, a, 1 - q * .3, 1 + q * .3, FALL_EASING), pose(.56, x, 0, -a * .35, 1 + q, 1 - q), pose(.81, x * .2, -h * .13, -a * .6, 1 - q * .2, 1 + q * .2, FALL_EASING), end]
  if (kind === 'wiggle') return [start, pose(.18, -x * .18, 0, -a, 1 + q, 1 - q), pose(.36, x * .18, -h * .2, a, 1 - q * .5, 1 + q * .5), pose(.55, -x * .13, 0, -a * .8, 1 + q * .65, 1 - q * .65), pose(.74, x * .1, -h * .1, a * .5, 1 - q * .25, 1 + q * .25, FALL_EASING), end]
  if (kind === 'peek') return [start, pose(.18, 0, 0, -a * .35, 1 - q * .2, 1 + q * .2), pose(.4, x * .7, -h * .12, a, 1 - q * .4, 1 + q * .4), pose(.68, x * .7, -h * .12, a, 1 - q * .4, 1 + q * .4), pose(.86, -x * .1, 0, -a * .3, 1 + q * .3, 1 - q * .3), end]
  return [start, pose(.13, 0, 0, -a, 1 + q, 1 - q), pose(.36, 0, -h, direction * 135, 1 - q * .25, 1 + q * .25, FALL_EASING), pose(.62, 0, -h * .45, direction * 285, 1 - q * .15, 1 + q * .15), pose(.8, 0, 0, direction * 360, 1 + q, 1 - q), pose(1, 0, 0, direction * 360)]
}

export function createIdleMotion(kind: IdleMotionKind, direction: IdleDirection, personality: IdlePersonality, maxTravelX = IDLE_PERSONALITIES[personality].travel): IdleMotion {
  const config = IDLE_PERSONALITIES[personality]
  const travel = Number.isFinite(maxTravelX) ? Math.min(config.travel, Math.max(0, maxTravelX)) : config.travel
  const keyframes = bodyFrames(kind, direction, personality, travel)
  const look = rounded(Math.min(IDLE_SIZE_PX * .11, 5) * direction)
  const faceKeyframes: ReadonlyArray<IdleFaceFrame> = [{ transform: 'translateX(0px) scaleY(1)', offset: 0 }, { transform: `translateX(${look}px) scaleY(1)`, offset: .28 }, { transform: `translateX(${look}px) scaleY(.12)`, offset: .58 }, { transform: `translateX(${look}px) scaleY(1)`, offset: .67 }, { transform: 'translateX(0px) scaleY(1)', offset: 1 }]
  const shadowKeyframes = keyframes.map((frame): IdleShadowFrame => {
    const numbers = frame.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)
    const horizontal = Number(numbers?.[1] ?? 0), height = Math.abs(Number(numbers?.[2] ?? 0)), airborne = height / config.jump
    return { offset: frame.offset, easing: frame.easing, opacity: .12 - airborne * .075, transform: `translateX(${horizontal}px) scaleX(${1 - airborne * .45})` }
  })
  return { kind, direction, durationMs: Math.round(config.baseMs * DURATION_FACTORS[kind]), easing: MOTION_EASING, transformOrigin: kind === 'spin' ? '50% 50%' : '50% 100%', keyframes, faceKeyframes, shadowKeyframes }
}

function chooseMotion(random: () => number, previousKind: IdleMotionKind | null, personality: IdlePersonality): IdleMotion {
  let selectedKind: IdleMotionKind = 'bounce'
  if (previousKind !== null) {
    const available = IDLE_PERSONALITIES[personality].kinds.filter((kind) => kind !== previousKind)
    const index = Math.min(available.length - 1, Math.floor(boundedRandomSample(random) * available.length))
    selectedKind = available[index] ?? 'bounce'
  }
  return createIdleMotion(selectedKind, boundedRandomSample(random) < .5 ? -1 : 1, personality)
}

function beginImmediateMotion({ random, startMotion, resetNeutral, personality, previousKind, setPrevious, setActive, getGeneration, canFinish, onFinish, onFailure }: { random: () => number; startMotion: (motion: IdleMotion) => IdleAnimation | null; resetNeutral: () => void; personality: IdlePersonality; previousKind: IdleMotionKind | null; setPrevious: (kind: IdleMotionKind) => void; setActive: (animation: IdleAnimation | null) => void; getGeneration: () => number; canFinish: (animation: IdleAnimation, generation: number) => boolean; onFinish: () => void; onFailure: () => void }): boolean {
  const motion = chooseMotion(random, previousKind, personality)
  let animation: IdleAnimation | null
  try { animation = startMotion(motion) } catch { resetNeutral(); onFailure(); return false }
  if (!animation) { resetNeutral(); onFailure(); return false }
  setPrevious(motion.kind); setActive(animation)
  const generation = getGeneration()
  void animation.finished.then(() => { if (!canFinish(animation!, generation)) return; setActive(null); resetNeutral(); onFinish() }, () => { if (!canFinish(animation!, generation)) return; setActive(null); resetNeutral(); onFailure() })
  return true
}

export function createIdleMotionController({ random, schedule, startMotion, resetNeutral, personality }: { random: () => number; schedule: IdleScheduler; startMotion: (motion: IdleMotion) => IdleAnimation | null; resetNeutral: () => void; personality: IdlePersonality }): IdleMotionController {
  let identity: string | null = null, eligible = false, disposed = false, supported = true, previousKind: IdleMotionKind | null = null, generation = 0
  let cancelDeadline: (() => void) | null = null, activeAnimation: IdleAnimation | null = null
  const cancelCurrentWork = (forceNeutral = false) => { generation += 1; cancelDeadline?.(); cancelDeadline = null; const animation = activeAnimation; activeAnimation = null; if (animation) { try { animation.cancel() } catch { supported = false } } if (animation || forceNeutral) resetNeutral() }
  const begin = () => beginImmediateMotion({ random, startMotion, resetNeutral, personality, previousKind, setPrevious: (kind) => { previousKind = kind }, setActive: (animation) => { activeAnimation = animation }, getGeneration: () => generation, canFinish: (animation, startedGeneration) => !disposed && eligible && activeAnimation === animation && startedGeneration === generation, onFinish: () => scheduleNext(IDLE_PERSONALITIES[personality].rest), onFailure: () => { supported = false } })
  const scheduleNext = (range: readonly [number, number]) => {
    if (disposed || !eligible || !identity || !supported) return
    cancelDeadline?.(); const scheduledGeneration = generation; let scheduledCancel: (() => void) | null = null
    const onDeadline = () => { if (cancelDeadline !== scheduledCancel || disposed || !eligible || !identity || !supported || scheduledGeneration !== generation) return; cancelDeadline = null; begin() }
    scheduledCancel = schedule(onDeadline, sampledDelay(random, range)); cancelDeadline = scheduledCancel
  }
  const scheduleFirst = () => scheduleNext(IDLE_PERSONALITIES[personality].firstWait)
  return {
    update(next) { if (disposed) return; const identityChanged = next.identity !== identity, eligibilityChanged = next.eligible !== eligible; if (!identityChanged && !eligibilityChanged) return; const initialized = identity !== null; cancelCurrentWork(!next.eligible || (initialized && identityChanged)); identity = next.identity; eligible = next.eligible; if (identityChanged) { previousKind = null; supported = true } scheduleFirst() },
    activity() { if (disposed || !supported) return; cancelCurrentWork(); scheduleFirst() },
    play() { if (disposed || !eligible || !identity || !supported) return; cancelCurrentWork(); begin() },
    dispose() { if (disposed) return; disposed = true; cancelCurrentWork(true) },
  }
}
