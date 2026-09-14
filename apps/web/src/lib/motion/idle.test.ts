import { describe, expect, it } from 'vitest'
import { createIdleMotion, createIdleMotionController, IDLE_PERSONALITIES, type IdleAnimation, type IdleMotion, type IdleMotionFrame, type IdleMotionKind, type IdleScheduler } from './idle'

const RISE = 'cubic-bezier(0.22, 1, 0.36, 1)', FALL = 'cubic-bezier(0.65, 0, 0.35, 1)', NEUTRAL = 'translate3d(0px, 0px, 0) rotate(0deg) scale(1, 1)'
const frames: Record<IdleMotionKind, ReadonlyArray<IdleMotionFrame>> = {
  bounce: [
    { offset: 0, easing: RISE, transform: NEUTRAL },
    { offset: .12, easing: RISE, transform: 'translate3d(0px, 0px, 0) rotate(-4.8deg) scale(1.28, 0.72)' },
    { offset: .34, easing: FALL, transform: 'translate3d(0px, -32px, 0) rotate(10.8deg) scale(0.87, 1.13)' },
    { offset: .66, easing: RISE, transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(1.28, 0.72)' },
    { offset: .81, easing: FALL, transform: 'translate3d(0px, -5.76px, 0) rotate(-3.6deg) scale(0.96, 1.04)' },
    { offset: 1, easing: RISE, transform: NEUTRAL },
  ],
  'double-hop': [
    { offset: 0, easing: RISE, transform: NEUTRAL },
    { offset: .09, easing: RISE, transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(1.28, 0.72)' },
    { offset: .24, easing: FALL, transform: 'translate3d(-6.72px, -20.8px, 0) rotate(-10.8deg) scale(0.92, 1.08)' },
    { offset: .4, easing: RISE, transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(1.28, 0.72)' },
    { offset: .61, easing: FALL, transform: 'translate3d(11.2px, -32px, 0) rotate(15.6deg) scale(0.89, 1.11)' },
    { offset: .83, easing: RISE, transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(1.22, 0.78)' },
    { offset: 1, easing: RISE, transform: NEUTRAL },
  ],
  scoot: [
    { offset: 0, easing: RISE, transform: NEUTRAL },
    { offset: .13, easing: RISE, transform: 'translate3d(-6.72px, 0px, 0) rotate(-14.4deg) scale(1.14, 0.86)' },
    { offset: .4, easing: FALL, transform: 'translate3d(56px, -7.04px, 0) rotate(24deg) scale(0.92, 1.08)' },
    { offset: .56, easing: RISE, transform: 'translate3d(56px, 0px, 0) rotate(-8.4deg) scale(1.28, 0.72)' },
    { offset: .81, easing: FALL, transform: 'translate3d(11.2px, -4.16px, 0) rotate(-14.4deg) scale(0.94, 1.06)' },
    { offset: 1, easing: RISE, transform: NEUTRAL },
  ],
  wiggle: [
    { offset: 0, easing: RISE, transform: NEUTRAL },
    { offset: .18, easing: RISE, transform: 'translate3d(-10.08px, 0px, 0) rotate(-24deg) scale(1.28, 0.72)' },
    { offset: .36, easing: RISE, transform: 'translate3d(10.08px, -6.4px, 0) rotate(24deg) scale(0.86, 1.14)' },
    { offset: .55, easing: RISE, transform: 'translate3d(-7.28px, 0px, 0) rotate(-19.2deg) scale(1.18, 0.82)' },
    { offset: .74, easing: FALL, transform: 'translate3d(5.6px, -3.2px, 0) rotate(12deg) scale(0.93, 1.07)' },
    { offset: 1, easing: RISE, transform: NEUTRAL },
  ],
  peek: [
    { offset: 0, easing: RISE, transform: NEUTRAL },
    { offset: .18, easing: RISE, transform: 'translate3d(0px, 0px, 0) rotate(-8.4deg) scale(0.94, 1.06)' },
    { offset: .4, easing: RISE, transform: 'translate3d(39.2px, -3.84px, 0) rotate(24deg) scale(0.89, 1.11)' },
    { offset: .68, easing: RISE, transform: 'translate3d(39.2px, -3.84px, 0) rotate(24deg) scale(0.89, 1.11)' },
    { offset: .86, easing: RISE, transform: 'translate3d(-5.6px, 0px, 0) rotate(-7.2deg) scale(1.08, 0.92)' },
    { offset: 1, easing: RISE, transform: NEUTRAL },
  ],
  spin: [
    { offset: 0, easing: RISE, transform: NEUTRAL },
    { offset: .13, easing: RISE, transform: 'translate3d(0px, 0px, 0) rotate(-24deg) scale(1.28, 0.72)' },
    { offset: .36, easing: FALL, transform: 'translate3d(0px, -32px, 0) rotate(135deg) scale(0.93, 1.07)' },
    { offset: .62, easing: RISE, transform: 'translate3d(0px, -14.4px, 0) rotate(285deg) scale(0.96, 1.04)' },
    { offset: .8, easing: RISE, transform: 'translate3d(0px, 0px, 0) rotate(360deg) scale(1.28, 0.72)' },
    { offset: 1, easing: RISE, transform: 'translate3d(0px, 0px, 0) rotate(360deg) scale(1, 1)' },
  ],
}

const kinds = Object.keys(frames) as IdleMotionKind[]
const durations: Record<IdleMotionKind, number> = { bounce: 1_000, 'double-hop': 1_250, scoot: 1_100, wiggle: 900, peek: 1_200, spin: 1_300 }
function mirror(frame: IdleMotionFrame): IdleMotionFrame {
  const match = frame.transform.match(/^translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) rotate\(([-\d.]+)deg\) scale\(([-\d.]+), ([-\d.]+)\)$/)!
  const inverted = (value: string) => Number(value) === 0 ? 0 : -Number(value)
  return { ...frame, transform: `translate3d(${inverted(match[1]!)}px, ${match[2]}px, 0) rotate(${inverted(match[3]!)}deg) scale(${match[4]}, ${match[5]})` }
}

interface Scheduled { callback: () => void; delay: number; canceled: boolean }
function scheduler() {
  let pending: Scheduled | undefined
  const canceled: Scheduled[] = []
  const schedule: IdleScheduler = (callback, delay) => { expect(pending).toBeUndefined(); const item = { callback, delay, canceled: false }; pending = item; return () => { item.canceled = true; canceled.push(item); if (pending === item) pending = undefined } }
  return { schedule, delay: () => pending?.delay, fire: () => { expect(pending).toBeDefined(); const item = pending!; pending = undefined; if (!item.canceled) item.callback() }, fireCanceled: () => canceled.at(-1)?.callback() }
}
function animations() {
  const started: IdleMotion[] = [], active: Array<{ canceled: boolean; resolve: () => void }> = []
  return { started, active, start(motion: IdleMotion): IdleAnimation { let resolve!: () => void; const finished = new Promise<void>((done) => { resolve = done }); started.push(motion); const item = { canceled: false, resolve }; active.push(item); return { finished, cancel: () => { item.canceled = true } } }, finish(index: number) { active[index]?.resolve() } }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
function sequence(values: number[]) { let index = 0; return () => values[index++] ?? .5 }

describe('idle personality choreography', () => {
  it('matches every gremlin reference pose, mirror, and duration', () => {
    for (const kind of kinds) {
      const positive = createIdleMotion(kind, 1, 'gremlin'), negative = createIdleMotion(kind, -1, 'gremlin')
      expect(positive.keyframes).toEqual(frames[kind]); expect(negative.keyframes).toEqual(frames[kind].map(mirror)); expect(positive.durationMs).toBe(durations[kind]); expect(negative.durationMs).toBe(durations[kind])
      expect(positive.transformOrigin).toBe(kind === 'spin' ? '50% 50%' : '50% 100%')
      expect(positive.keyframes.at(-1)?.offset).toBe(1); expect(positive.faceKeyframes.at(-1)).toEqual({ transform: 'translateX(0px) scaleY(1)', offset: 1 }); expect(positive.shadowKeyframes.at(-1)).toMatchObject({ opacity: .12, transform: 'translateX(0px) scaleX(1)', offset: 1 })
    }
  })
  it('uses personality base durations and safe travel clamps', () => {
    for (const personality of ['calm', 'playful', 'curious', 'gremlin'] as const) for (const kind of kinds) expect(createIdleMotion(kind, 1, personality).durationMs).toBe(Math.round(IDLE_PERSONALITIES[personality].baseMs * durations[kind] / 1_000))
    expect(createIdleMotion('scoot', 1, 'gremlin', 12).keyframes[2]?.transform).toContain('translate3d(12px')
    expect(createIdleMotion('scoot', 1, 'gremlin', Number.NaN).keyframes).toEqual(frames.scoot)
  })
})

describe('idle personality policy', () => {
  it('schedules every personality inside its first-wait and rest bounds', async () => {
    for (const personality of ['calm', 'playful', 'curious', 'gremlin'] as const) for (const sample of [0, 1] as const) {
      const timing = scheduler(), motion = animations(), controller = createIdleMotionController({ personality, random: () => sample, schedule: timing.schedule, startMotion: motion.start, resetNeutral() {} })
      controller.update({ eligible: true, identity: `${personality}:${sample}` }); expect(timing.delay()).toBe(IDLE_PERSONALITIES[personality].firstWait[sample]); timing.fire(); motion.finish(0); await flush(); expect(timing.delay()).toBe(IDLE_PERSONALITIES[personality].rest[sample]); controller.dispose()
    }
  })
  it('starts with bounce, never repeats, and samples wait ranges', async () => {
    const timing = scheduler(), motion = animations(), random = sequence([0, 0, 1, 1, 1])
    const controller = createIdleMotionController({ personality: 'gremlin', random, schedule: timing.schedule, startMotion: motion.start, resetNeutral() {} })
    controller.update({ eligible: true, identity: 'bot:a' }); expect(timing.delay()).toBe(1_200); timing.fire(); expect(motion.started[0]).toMatchObject({ kind: 'bounce', direction: -1 })
    motion.finish(0); await flush(); expect(timing.delay()).toBe(4_200); timing.fire(); expect(motion.started[1]).toMatchObject({ kind: 'spin', direction: 1 }); expect(motion.started[1]?.kind).not.toBe(motion.started[0]?.kind)
  })
  it('keeps calm to bounce and peek and gives curious three peek slots', async () => {
    const calmTiming = scheduler(), calmMotion = animations(), calm = createIdleMotionController({ personality: 'calm', random: () => .99, schedule: calmTiming.schedule, startMotion: calmMotion.start, resetNeutral() {} })
    calm.update({ eligible: true, identity: 'calm' }); calmTiming.fire(); calmMotion.finish(0); await flush(); calmTiming.fire(); expect(calmMotion.started.map((item) => item.kind)).toEqual(['bounce', 'peek'])
    for (const selection of [.44, .58, .72]) {
      const timing = scheduler(), motion = animations(), random = sequence([0, 0, 0, selection, 0])
      const controller = createIdleMotionController({ personality: 'curious', random, schedule: timing.schedule, startMotion: motion.start, resetNeutral() {} })
      controller.update({ eligible: true, identity: String(selection) }); timing.fire(); motion.finish(0); await flush(); timing.fire(); expect(motion.started[1]?.kind).toBe('peek')
    }
  })
  it('activity cancels and rearms while stale completions and deadlines are ignored', async () => {
    const timing = scheduler(), motion = animations(); let resets = 0
    const controller = createIdleMotionController({ personality: 'playful', random: () => 0, schedule: timing.schedule, startMotion: motion.start, resetNeutral: () => { resets += 1 } })
    controller.update({ eligible: true, identity: 'bot:a' }); timing.fire(); controller.activity(); expect(motion.active[0]?.canceled).toBe(true); expect(timing.delay()).toBe(2_200)
    motion.finish(0); await flush(); expect(timing.delay()).toBe(2_200); expect(resets).toBe(1)
    controller.activity(); const replacement = timing.delay(); timing.fireCanceled(); expect(timing.delay()).toBe(replacement)
  })
  it('identity changes reset history and dispose clears all work', async () => {
    const timing = scheduler(), motion = animations(); let resets = 0
    const controller = createIdleMotionController({ personality: 'gremlin', random: () => 0, schedule: timing.schedule, startMotion: motion.start, resetNeutral: () => { resets += 1 } })
    controller.update({ eligible: true, identity: 'bot:a' }); timing.fire(); motion.finish(0); await flush(); timing.fire(); expect(motion.started[1]?.kind).toBe('double-hop')
    controller.update({ eligible: true, identity: 'bot:b' }); expect(motion.active[1]?.canceled).toBe(true); timing.fire(); expect(motion.started[2]?.kind).toBe('bounce')
    controller.dispose(); expect(motion.active[2]?.canceled).toBe(true); expect(timing.delay()).toBeUndefined(); const before = resets; motion.finish(2); await flush(); expect(resets).toBe(before)
  })
  it('stays neutral without animation support and schedules nothing else', () => {
    const timing = scheduler(); let resets = 0
    const controller = createIdleMotionController({ personality: 'gremlin', random: () => 0, schedule: timing.schedule, startMotion: () => null, resetNeutral: () => { resets += 1 } })
    controller.update({ eligible: true, identity: 'bot:a' }); timing.fire(); expect(timing.delay()).toBeUndefined(); controller.activity(); expect(timing.delay()).toBeUndefined(); expect(resets).toBe(1); controller.dispose(); expect(resets).toBe(2)
  })
})
