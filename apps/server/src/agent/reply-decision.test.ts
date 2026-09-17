import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JevExperimentSettings } from '@openstaff/shared'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DecisionServiceError, JevDecisionService, ReplyDecisionExperiment, ReplyDecisionExperimentManager, replyDecisionExperimentFromSettings, replyDecisionFileObserver, type ReplyDecisionState, type ReplyEvaluation } from './reply-decision.js'

const state: ReplyDecisionState = { candidate: { name: 'Ari', job: 'Backend engineer' }, teammates: 'Bea: Designer', trigger: { authorKind: 'user', text: 'Fix the API.' }, history: 'Owner: Fix the API.', recentReplies: '(None yet.)' }
const evaluation: ReplyEvaluation = { model: 'jev-test', probabilities: { addressed: 0.05, relevant: 0.99, actionable: 0.99, covered: 0.01, new_information: 0.01 }, usage: { input_tokens: 200, output_tokens: 40 } }
const baseline = async () => ({ reply: false, model: 'baseline-test', usage: { inputTokens: 100, outputTokens: 10 } })

afterEach(() => vi.useRealTimers())

describe('Jev reply decisions', () => {
  it('uses the native API and validates every required probability', async () => {
    const response = { model: 'jev-test', answers: Object.fromEntries(Object.entries(evaluation.probabilities).map(([key, value]) => [key, { type: 'noul', noul: value }])), usage: evaluation.usage }
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response)))
    const service = new JevDecisionService('synthetic-test-key', 'jev-test', request)
    expect(await service.evaluate(state, new AbortController().signal)).toEqual(evaluation)
    const [url, init] = request.mock.calls[0]!
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: 'jev-test', state, questions: { covered: { type: 'noul' } } })
    response.answers.covered = { type: 'noul', noul: 1.2 }
    request.mockResolvedValue(new Response(JSON.stringify(response)))
    await expect(service.evaluate(state, new AbortController().signal)).rejects.toThrow('invalid_response')
    delete response.answers.covered
    request.mockResolvedValue(new Response(JSON.stringify(response)))
    await expect(service.evaluate(state, new AbortController().signal)).rejects.toThrow('invalid_response')
  })

  it('never retries provider errors or exposes their bodies', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('echoed private room text', { status: 429 }))
    const service = new JevDecisionService('synthetic-test-key', undefined, request)
    await expect(service.evaluate(state, new AbortController().signal)).rejects.toThrow(/^http_429$/)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('returns the baseline before a slow shadow completes, even when Jev disagrees', async () => {
    let resolve!: (value: ReplyEvaluation) => void
    const experiment = new ReplyDecisionExperiment({ evaluate: () => new Promise((done) => { resolve = done }) })
    const record = vi.fn()
    expect(await experiment.compare({ roomId: 'room-a', state, baseline, record })).toBe(false)
    expect(record).not.toHaveBeenCalled()
    resolve(evaluation)
    await experiment.drain()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ agrees: false, baseline: expect.objectContaining({ reply: false }), jev: expect.objectContaining({ recommendation: 'reply' }) }))
    expect(JSON.stringify(record.mock.calls)).not.toContain('Fix the API')
    await experiment.close()
  })

  it('records provider failure without changing the baseline answer', async () => {
    const experiment = new ReplyDecisionExperiment({ evaluate: async () => { throw new DecisionServiceError('http_529') } })
    const record = vi.fn()
    expect(await experiment.compare({ roomId: 'room-a', state, baseline, record })).toBe(false)
    await experiment.drain()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ agrees: null, jev: expect.objectContaining({ error: 'http_529' }) }))
    await experiment.close()
  })

  it('preserves baseline failures instead of substituting a Jev answer', async () => {
    const experiment = new ReplyDecisionExperiment({ evaluate: async () => evaluation })
    const record = vi.fn()
    await expect(experiment.compare({ roomId: 'room-a', state, baseline: async () => { throw new Error('baseline unavailable') }, record })).rejects.toThrow('baseline unavailable')
    await experiment.drain()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ baseline: expect.objectContaining({ error: 'baseline_error' }), agrees: null }))
    await experiment.close()
  })

  it('enforces the room cohort without making an external request', async () => {
    const evaluate = vi.fn(async () => evaluation), record = vi.fn()
    const experiment = new ReplyDecisionExperiment({ evaluate }, { roomIds: new Set(['room-pilot']) })
    expect(await experiment.compare({ roomId: 'room-other', state, baseline, record })).toBe(false)
    expect(evaluate).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
    await experiment.close()
  })

  it('aborts in-flight requests and does not write events after shutdown', async () => {
    let observedSignal: AbortSignal | undefined
    const experiment = new ReplyDecisionExperiment({ evaluate: (_state, signal) => new Promise((_resolve, reject) => {
      observedSignal = signal
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }) })
    const record = vi.fn()
    expect(await experiment.compare({ roomId: 'room-a', state, baseline, record })).toBe(false)
    await experiment.close()
    expect(observedSignal?.aborted).toBe(true)
    expect(record).not.toHaveBeenCalled()
  })

  it('cancels timed-out requests while leaving the baseline successful', async () => {
    const experiment = new ReplyDecisionExperiment({ evaluate: (_state, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }) }, { timeoutMs: 10 })
    const record = vi.fn()
    expect(await experiment.compare({ roomId: 'room-a', state, baseline, record })).toBe(false)
    await experiment.drain()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ jev: expect.objectContaining({ error: 'timeout' }) }))
    await experiment.close()
  })

  it('isolates telemetry failures from the room scheduler', async () => {
    const onRecordError = vi.fn()
    const experiment = new ReplyDecisionExperiment({ evaluate: async () => evaluation }, { onRecordError })
    expect(await experiment.compare({ roomId: 'room-a', state, baseline, record: async () => { throw new Error('database unavailable') } })).toBe(false)
    await experiment.drain()
    expect(onRecordError).toHaveBeenCalledTimes(1)
    await experiment.close()
  })

  it('serializes concurrent file observations without storing room content', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-reply-log-'))
    const file = path.join(directory, 'experiments', 'replies.jsonl')
    const experiment = new ReplyDecisionExperiment({ evaluate: async () => evaluation }, { record: replyDecisionFileObserver(file) })
    try {
      await Promise.all(Array.from({ length: 12 }, (_, index) => experiment.compare({ roomId: 'room-a', turnId: `turn-${index}`, state, baseline })))
      await experiment.drain()
      const lines = (await fs.readFile(file, 'utf8')).trim().split('\n')
      const rows = lines.map((line) => JSON.parse(line))
      expect(new Set(rows.map((row) => row.turnId)).size).toBe(12)
      expect(rows.every((row) => row.experiment === 'jev-reply-shadow' && row.agrees === false)).toBe(true)
      expect(lines.join('\n')).not.toContain('Fix the API')
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    } finally { await experiment.close(); await fs.rm(directory, { recursive: true, force: true }) }
  })

  it('builds nothing unless settings ask for shadow and a key exists', () => {
    const shadow: JevExperimentSettings = { mode: 'shadow', model: 'jev-latest', timeoutMs: 1_200, roomIds: ['room-pilot'] }
    expect(replyDecisionExperimentFromSettings({ ...shadow, mode: 'off' }, 'synthetic-test-key', './data')).toBeUndefined()
    expect(replyDecisionExperimentFromSettings({ ...shadow, roomIds: [] }, undefined, './data')).toBeUndefined()
    expect(replyDecisionExperimentFromSettings({ ...shadow, roomIds: [] }, '', './data')).toBeUndefined()
    const experiment = replyDecisionExperimentFromSettings(shadow, 'synthetic-test-key', './data')!
    expect(experiment).toBeInstanceOf(ReplyDecisionExperiment)
    expect(experiment.applies('room-pilot')).toBe(true)
    expect(experiment.applies('room-other')).toBe(false)
  })

  it('hot swaps the experiment without losing an observation the old instance is writing', async () => {
    const jevResponse = { model: 'jev-test', answers: Object.fromEntries(Object.entries(evaluation.probabilities).map(([key, value]) => [key, { type: 'noul', noul: value }])), usage: evaluation.usage }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(jevResponse)))
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-reply-manager-'))
    const manager = new ReplyDecisionExperimentManager(directory)
    try {
      await manager.configure({ mode: 'shadow', model: 'jev-latest', timeoutMs: 1_200, roomIds: ['room-pilot'] }, 'synthetic-test-key')
      const first = manager.get()!
      expect(first.applies('room-pilot')).toBe(true)
      expect(first.applies('room-other')).toBe(false)
      let release!: () => void
      const held = new Promise<void>((resolve) => { release = resolve })
      let started = false, recorded = false
      void first.compare({ roomId: 'room-pilot', state, baseline, record: async () => { started = true; await held; recorded = true } })
      await vi.waitFor(() => expect(started).toBe(true))
      let swapped = false
      const swap = manager.configure({ mode: 'shadow', model: 'jev-next', timeoutMs: 1_200, roomIds: [] }, 'synthetic-test-key').then(() => { swapped = true })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(swapped).toBe(false)
      expect(recorded).toBe(false)
      release()
      await swap
      expect(recorded).toBe(true)
      expect(first.applies('room-pilot')).toBe(false)
      const second = manager.get()!
      expect(second).not.toBe(first)
      expect(second.applies('room-other')).toBe(true)
      await manager.configure({ mode: 'off', model: 'jev-latest', timeoutMs: 1_200, roomIds: [] }, 'synthetic-test-key')
      expect(manager.get()).toBeUndefined()
      expect(second.applies('room-other')).toBe(false)
    } finally { await manager.close(); vi.unstubAllGlobals(); await fs.rm(directory, { recursive: true, force: true }) }
  })
})
