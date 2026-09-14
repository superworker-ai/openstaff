import { describe, expect, it } from 'vitest'
import { createWorkingMotion, createWorkingMotionController, createWorkingTiming, WORKING_CHAIR_WIGGLE_DEG, WORKING_CHAIR_WIGGLE_MS, WORKING_FIRST_QUIRK_MAX_MS, WORKING_FIRST_QUIRK_MIN_MS, WORKING_FURIOUS_CADENCE_MS, WORKING_LOOK_BACK_MS, WORKING_QUIRK_MAX_MS, WORKING_QUIRK_MIN_MS, WORKING_TYPING_CADENCE_MS, WORKING_TYPING_PAIRS, WORKING_TYPING_REST_MS, type WorkingAnimation, type WorkingMotion, type WorkingScheduler } from './working'

interface Scheduled { callback: () => void; delay: number; canceled: boolean }
function scheduler() {
  let pending: Scheduled | undefined
  const canceled: Scheduled[] = []
  const schedule: WorkingScheduler = (callback, delay) => { expect(pending).toBeUndefined(); const item = { callback, delay, canceled: false }; pending = item; return () => { item.canceled = true; canceled.push(item); if (pending === item) pending = undefined } }
  return { schedule, pending: () => pending, canceled, fire(expected?: number) { expect(pending).toBeDefined(); if (expected !== undefined) expect(pending?.delay).toBe(expected); const item = pending!; pending = undefined; if (!item.canceled) item.callback() } }
}
function animations() {
  const started: WorkingMotion[] = [], active: Array<{ canceled: boolean; resolve: () => void; reject: () => void }> = []
  return { started, active, start(motion: WorkingMotion): WorkingAnimation { let resolve!: () => void, reject!: () => void; const finished = new Promise<void>((done, fail) => { resolve = done; reject = fail }); const item = { canceled: false, resolve, reject }; started.push(motion); active.push(item); return { finished, cancel: () => { item.canceled = true } } }, finish(index: number) { active[index]?.resolve() }, fail(index: number) { active[index]?.reject() } }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

describe('working character choreography', () => {
  it('matches the workstation tracks and retained quirk durations', () => {
    expect(WORKING_TYPING_CADENCE_MS).toBe(240); expect(WORKING_TYPING_PAIRS).toBe(7); expect(WORKING_TYPING_REST_MS).toBe(360); expect(WORKING_LOOK_BACK_MS).toBe(1_800); expect(WORKING_CHAIR_WIGGLE_MS).toBe(1_500); expect(WORKING_CHAIR_WIGGLE_DEG).toBe(7); expect(WORKING_FURIOUS_CADENCE_MS).toBe(156)
    const typing = createWorkingMotion('typing')
    expect(typing.durationMs).toBe(1_680); expect(typing.restMs).toBe(360); expect(typing.tracks).toEqual([
      { part: 'body', durationMs: 1_680, iterations: 1, keyframes: [{ transform: 'rotate(-2.1deg) translateY(0)' }, { transform: 'rotate(2.1deg) translateY(-1px)' }, { transform: 'rotate(-2.1deg) translateY(0)' }] },
      { part: 'screen-lines', durationMs: 1_680, iterations: 1, easing: 'steps(2)', keyframes: [{ opacity: 1 }, { opacity: .35 }, { opacity: 1 }] },
    ])
    const furious = createWorkingMotion('furious-typing')
    expect(furious.durationMs).toBe(2_184); expect(furious.restMs).toBe(600); expect(furious.tracks.every((track) => track.durationMs === 156 && track.iterations === 14)).toBe(true)
    expect(furious.tracks.find((track) => track.part === 'screen-lines')?.easing).toBe('steps(2)')
    const lookBack = createWorkingMotion('look-back')
    expect(lookBack.durationMs).toBe(1_800); expect(lookBack.tracks).toEqual([{ part: 'body', durationMs: 1_800, iterations: 1, keyframes: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-14deg) translateX(-3px)', offset: .3 }, { transform: 'rotate(-14deg) translateX(-3px)', offset: .72 }, { transform: 'rotate(0deg)' }] }])
    const wiggle = createWorkingMotion('chair-wiggle')
    expect(wiggle.durationMs).toBe(1_500); expect(wiggle.tracks[0]?.part).toBe('body'); expect(wiggle.tracks[0]?.keyframes.map((frame) => frame.transform)).toEqual(['rotate(0deg) translateY(0px)', 'rotate(-7deg) translateY(-2px)', 'rotate(7deg) translateY(-2px)', 'rotate(-5.6deg) translateY(-1.6px)', 'rotate(4.9deg) translateY(-1.4px)', 'rotate(-2.8deg) translateY(-0.8px)', 'rotate(0deg) translateY(0px)'])
    for (const kind of ['typing', 'look-back', 'chair-wiggle', 'furious-typing'] as const) expect(createWorkingMotion(kind).tracks.every((track) => track.part === 'body' || track.part === 'screen-lines')).toBe(true)
  })
  it('seeds deterministic bounded timing and rotates every quirk', () => {
    const first = createWorkingTiming('bot:one'), same = createWorkingTiming('bot:one'), second = createWorkingTiming('bot:two')
    expect(first).toEqual(same); expect(first).not.toEqual(second)
    for (const timing of [first, second]) { expect(timing.initialDelayMs).toBeGreaterThanOrEqual(0); expect(timing.initialDelayMs).toBeLessThanOrEqual(400); expect(timing.firstQuirkAtMs).toBeGreaterThanOrEqual(WORKING_FIRST_QUIRK_MIN_MS); expect(timing.firstQuirkAtMs).toBeLessThanOrEqual(WORKING_FIRST_QUIRK_MAX_MS); expect(timing.quirkSpacingMs).toBeGreaterThanOrEqual(WORKING_QUIRK_MIN_MS); expect(timing.quirkSpacingMs).toBeLessThanOrEqual(WORKING_QUIRK_MAX_MS); expect([...timing.quirkOrder].sort()).toEqual(['chair-wiggle', 'furious-typing', 'look-back']) }
  })
  it('runs typing bursts then the identity-seeded first quirk', async () => {
    const timing = createWorkingTiming('bot:one'), deadlines = scheduler(), motion = animations(), controller = createWorkingMotionController({ schedule: deadlines.schedule, startMotion: motion.start, resetNeutral() {} })
    controller.update({ active: true, identity: 'bot:one' }); deadlines.fire(timing.initialDelayMs); expect(motion.started[0]?.kind).toBe('typing'); motion.finish(0); await flush(); deadlines.fire(WORKING_TYPING_REST_MS)
    deadlines.fire(timing.firstQuirkAtMs - timing.initialDelayMs - createWorkingMotion('typing').durationMs - WORKING_TYPING_REST_MS); expect(motion.started[1]?.kind).toBe(timing.quirkOrder[0])
  })
  it('cancels active groups on inactive, identity change, and dispose', () => {
    const deadlines = scheduler(), motion = animations(); let resets = 0
    const controller = createWorkingMotionController({ schedule: deadlines.schedule, startMotion: motion.start, resetNeutral: () => { resets += 1 } })
    controller.update({ active: true, identity: 'bot:one' }); deadlines.fire(); controller.update({ active: false, identity: 'bot:one' }); expect(motion.active[0]?.canceled).toBe(true); expect(deadlines.pending()).toBeUndefined()
    controller.update({ active: true, identity: 'bot:one' }); expect(deadlines.pending()).toBeDefined(); controller.update({ active: true, identity: 'bot:two' }); expect(deadlines.canceled.at(-1)?.canceled).toBe(true); expect(deadlines.pending()).toBeDefined(); controller.dispose(); expect(deadlines.pending()).toBeUndefined(); expect(resets).toBeGreaterThanOrEqual(3)
  })
  it('is inert while inactive and stops after animation failure', async () => {
    const deadlines = scheduler(), motion = animations(), controller = createWorkingMotionController({ schedule: deadlines.schedule, startMotion: motion.start, resetNeutral() {} })
    controller.update({ active: false, identity: 'bot:one' }); expect(deadlines.pending()).toBeUndefined(); controller.update({ active: true, identity: 'bot:one' }); deadlines.fire(); motion.fail(0); await flush(); expect(deadlines.pending()).toBeUndefined()
  })
})
