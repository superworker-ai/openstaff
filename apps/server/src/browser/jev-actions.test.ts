import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { MockLanguageModelV3 } from 'ai/test'
import { expect, it, vi } from 'vitest'
import { AgentRuntime } from '../agent/runtime.js'
import { bots, turns } from '../db/schema.js'
import { mockStream, mockUsage, textStream } from '../test/mock-model.js'
import { DecisionServiceError } from '../agent/reply-decision.js'
import { TurnEventRecorder } from '../agent/events.js'
import { BROWSER_TASKS, startBrowserFixture, type FixtureTask } from '../experiments/browser-fixture.js'
import { fixture } from '../test/fixture.js'
import {
  baselineBrowserAction, BrowserActionExperiment, BrowserActionExperimentManager, browserActionExperimentFromSettings, browserActionFileObserver,
  buildActionCandidates, JevActionService, MockActionProvider, parseSnapshotControls, resolveChoice, runBoundedBrowserTask,
  type ActionCandidate, type ActionDecision, type ActionDecisionProvider, type ActionDecisionState, type BrowserActionObservation, type SnapshotControl,
} from './jev-actions.js'
import { observedBrowserTools } from './observed-tools.js'
import { BrowserService, type BrowserSession } from './service.js'
import { browserTools } from './tools.js'

// Copied verbatim from Playwright 1.63 page.ariaSnapshot({ mode: 'ai' }) on the probe page below.
const SNAPSHOT = `- generic [active] [ref=e1]:
  - heading "Probe page" [level=1] [ref=e2]
  - generic [ref=e3]:
    - text: Name
    - textbox "Name" [ref=e4]
    - text: Search
    - searchbox "Search" [ref=e5]
    - text: I agree to the terms
    - checkbox "I agree to the terms" [ref=e6]
    - text: Country
    - combobox "Country" [ref=e7]:
      - option "MX" [selected]
    - button "Submit" [ref=e8]
    - button "Disabled thing" [disabled] [ref=e9]
    - checkbox "Already checked" [checked] [ref=e10]
    - text: Already checked
  - link "Pricing" [ref=e11] [cursor=pointer]:
    - /url: /pricing
  - paragraph [ref=e12]: Some text`

const state: ActionDecisionState = { goal: 'Submit the form', url: 'http://127.0.0.1/greet', title: 'Greeting form', step: 0, history: [], page: '- button "Submit" [ref=e1]', candidates: [{ id: 'c1', description: 'Click the button "Submit"' }], truncated: false }
const control = (over: Partial<SnapshotControl> = {}): SnapshotControl => ({ ref: 'e1', role: 'button', name: 'Submit', disabled: false, line: '- button "Submit" [ref=e1]', ...over })
const ids = (candidates: ActionCandidate[]) => candidates.map((candidate) => candidate.id)

it('parses only interactive refs out of a real Playwright snapshot', () => {
  const controls = parseSnapshotControls(SNAPSHOT)
  expect(controls.map((item) => [item.role, item.name, item.ref, item.disabled])).toEqual([
    ['textbox', 'Name', 'e4', false],
    ['searchbox', 'Search', 'e5', false],
    ['checkbox', 'I agree to the terms', 'e6', false],
    ['combobox', 'Country', 'e7', false],
    ['button', 'Submit', 'e8', false],
    ['button', 'Disabled thing', 'e9', true],
    ['checkbox', 'Already checked', 'e10', false],
    ['link', 'Pricing', 'e11', false],
  ])
  expect(controls.find((item) => item.role === 'heading')).toBeUndefined()
  expect(controls.find((item) => item.role === 'paragraph')).toBeUndefined()
  expect(controls.find((item) => item.ref === 'e6')!.checked).toBe(false)
  expect(controls.find((item) => item.ref === 'e10')!.checked).toBe(true)
  expect(controls.find((item) => item.ref === 'e8')!.checked).toBeUndefined()
  expect(parseSnapshotControls('- text: Name\n- /url: /pricing\n- button "No ref"\n- butt')).toEqual([])
  // Playwright qualifies refs with a frame ordinal after a document navigation.
  expect(parseSnapshotControls('- textbox "Message" [ref=f1e4]')[0]!.ref).toBe('f1e4')
  expect(parseSnapshotControls('- textbox "Message" [ref=x1]')).toEqual([])
})

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('parses the same grammar from live Chromium', async () => {
  const f = await fixture(), browser = new BrowserService(f.directory)
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end('<title>Probe page</title><h1>Probe page</h1><label for="n">Name</label><input id="n"><label for="c">I agree</label><input id="c" type="checkbox" checked><button>Submit</button><button disabled>Disabled thing</button><a href="/next">Pricing</a>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const turn = (await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'probe' })).turns[0]!
  const session = browser.session(turn.id, new TurnEventRecorder(f.db, undefined, turn.id, f.roomId))
  try {
    await browserTools(session).browser_navigate.execute!({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}` }, { toolCallId: 'probe', messages: [], context: { turnId: turn.id, roomId: f.roomId, botId: f.botId, handoffDepth: 0 } })
    const controls = parseSnapshotControls(await session.snapshot())
    expect(controls.map((item) => [item.role, item.name, item.disabled, item.checked])).toEqual([
      ['textbox', 'Name', false, undefined],
      ['checkbox', 'I agree', false, true],
      ['button', 'Submit', false, undefined],
      ['button', 'Disabled thing', true, undefined],
      ['link', 'Pricing', false, undefined],
    ])
    expect(controls.every((item) => /^(f\d+)?e\d+$/.test(item.ref))).toBe(true)
    expect((await session.location()).title).toBe('Probe page')
  } finally { await session.close(); await browser.close(); await new Promise<void>((resolve) => server.close(() => resolve())); await f.close() }
}, 40_000)

it('builds one candidate per clickable control and per typeable control and value', () => {
  const { candidates, truncated } = buildActionCandidates({ controls: parseSnapshotControls(SNAPSHOT), typing: { kind: 'values', values: { name: 'Ada', city: 'Monterrey' } }, canGoBack: false })
  expect(truncated).toBe(false)
  expect(candidates.map((candidate) => candidate.description)).toEqual([
    'Type the name value into the textbox "Name"',
    'Type the city value into the textbox "Name"',
    'Type the name value into the searchbox "Search"',
    'Type the city value into the searchbox "Search"',
    'Click the checkbox "I agree to the terms"',
    'Type the name value into the combobox "Country"',
    'Type the city value into the combobox "Country"',
    'Click the button "Submit"',
    'Click the checkbox "Already checked"',
    'Click the link "Pricing"',
    'Take a fresh look at the page before choosing; use when the page seems mid-update or the listed controls look stale',
    'The goal is already achieved in the observed state; stop without acting',
    'Stop without acting because none of the listed actions is safe or useful for the goal',
  ])
  expect(ids(candidates).slice(0, 3)).toEqual(['c1', 'c2', 'c3'])
  expect(ids(candidates).slice(-3)).toEqual(['reobserve', 'done', 'abstain'])
  expect(candidates.find((candidate) => candidate.description.includes('Disabled thing'))).toBeUndefined()
  expect(candidates.find((candidate) => candidate.id === 'c1')!.action).toEqual({ kind: 'type', ref: 'e4', valueKey: 'name' })
})

it('offers one value-free typing candidate per control in model-text mode', () => {
  const { candidates } = buildActionCandidates({ controls: parseSnapshotControls(SNAPSHOT), typing: { kind: 'model-text' }, canGoBack: true })
  expect(candidates.filter((candidate) => candidate.action.kind === 'type').map((candidate) => [candidate.description, candidate.action])).toEqual([
    ['Type text into the textbox "Name"', { kind: 'type', ref: 'e4' }],
    ['Type text into the searchbox "Search"', { kind: 'type', ref: 'e5' }],
    ['Type text into the combobox "Country"', { kind: 'type', ref: 'e7' }],
  ])
  expect(ids(candidates).slice(-4)).toEqual(['back', 'reobserve', 'done', 'abstain'])
  expect(candidates.find((candidate) => candidate.id === 'back')!.description).toBe('Go back to the previous page')
})

it('omits back when there is no history and caps the executable table at forty', () => {
  const short = buildActionCandidates({ controls: [control()], typing: { kind: 'values', values: {} }, canGoBack: false })
  expect(ids(short.candidates)).toEqual(['c1', 'reobserve', 'done', 'abstain'])
  const many = Array.from({ length: 45 }, (_value, index) => control({ ref: `e${index + 1}`, name: `Button ${index + 1}` }))
  const capped = buildActionCandidates({ controls: many, typing: { kind: 'values', values: {} }, canGoBack: true })
  expect(capped.truncated).toBe(true)
  expect(capped.candidates.filter((candidate) => candidate.action.kind === 'click')).toHaveLength(40)
  expect(capped.candidates.at(39)!.description).toBe('Click the button "Button 40"')
  expect(ids(capped.candidates).slice(-4)).toEqual(['back', 'reobserve', 'done', 'abstain'])
})

it('fails closed on a choice that is not in the table', () => {
  const { candidates } = buildActionCandidates({ controls: [control()], typing: { kind: 'values', values: {} }, canGoBack: false })
  expect(resolveChoice('c1', candidates)!.action).toEqual({ kind: 'click', ref: 'e1' })
  expect(resolveChoice('c2', candidates)).toBeUndefined()
  expect(resolveChoice('', candidates)).toBeUndefined()
  expect(resolveChoice('__proto__', candidates)).toBeUndefined()
})

const table = buildActionCandidates({ controls: [control()], typing: { kind: 'values', values: {} }, canGoBack: false }).candidates
const jevBody = (over: Record<string, unknown> = {}) => JSON.stringify({
  model: 'jev-test',
  answers: { action: { type: 'choice', choice: 'c1', probabilities: { c1: 0.9, abstain: 0.1 }, confidence: 0.8 }, goal_achieved: { type: 'noul', noul: 0.02 } },
  usage: { input_tokens: 900, output_tokens: 12 },
  ...over,
})

it('posts one bounded choice question and validates the answer', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(jevBody()))
  const service = new JevActionService('synthetic-test-key', 'jev-test', request)
  expect(await service.decide(state, table, new AbortController().signal)).toEqual({
    choice: 'c1', probabilities: { c1: 0.9, abstain: 0.1 }, confidence: 0.8, goalAchieved: 0.02, model: 'jev-test', usage: { input_tokens: 900, output_tokens: 12 },
  })
  const [url, init] = request.mock.calls[0]!
  expect(url).toBe('https://api.typesafe.ai/v1/systemone')
  const body = JSON.parse(init!.body as string)
  expect(body.questions.action.type).toBe('choice')
  expect(Object.keys(body.questions.action.criteria)).toEqual(['c1', 'reobserve', 'done', 'abstain'])
  expect(body.questions.goal_achieved.type).toBe('noul')
  expect(init!.body).not.toContain('synthetic-test-key')
})

it('never retries provider errors, exposes their bodies, or trusts an unlisted choice', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('echoed page text', { status: 429 }))
  const service = new JevActionService('synthetic-test-key', 'jev-test', request)
  await expect(service.decide(state, table, new AbortController().signal)).rejects.toThrow(/^http_429$/)
  expect(request).toHaveBeenCalledTimes(1)
  request.mockResolvedValue(new Response('{'))
  await expect(service.decide(state, table, new AbortController().signal)).rejects.toThrow('invalid_response')
  request.mockResolvedValue(new Response(jevBody({ answers: { action: { type: 'choice', choice: 'c9', probabilities: { c9: 1 }, confidence: 1 }, goal_achieved: { type: 'noul', noul: 0 } } })))
  await expect(service.decide(state, table, new AbortController().signal)).rejects.toThrow('invalid_response')
  request.mockResolvedValue(new Response(jevBody({ answers: { action: { type: 'choice', choice: 'c1', probabilities: { c1: 1 }, confidence: 4 }, goal_achieved: { type: 'noul', noul: 0 } } })))
  await expect(service.decide(state, table, new AbortController().signal)).rejects.toThrow('invalid_response')
  await expect(new JevActionService('', 'jev-test', request).decide(state, table, new AbortController().signal)).rejects.toThrow('missing_key')
  const aborted = AbortSignal.abort()
  await expect(service.decide(state, table, aborted)).rejects.toThrow()
})

it('discards a decision whose page changed before the action could run', async () => {
  const snapshots = ['- button "Go" [ref=e1]', '- button "Go" [ref=e2]']
  let index = 0
  const session = {
    snapshot: async () => snapshots[Math.min(index++, snapshots.length - 1)]!,
    location: async () => ({ url: 'http://127.0.0.1/x', title: 'x' }),
  } as unknown as BrowserSession
  const click = vi.fn(async (_input: { ref: string }) => '- button "Go" [ref=e2]')
  const tools = {
    browser_navigate: { execute: vi.fn(async () => '- button "Go" [ref=e1]') },
    browser_click: { execute: click },
    browser_type: { execute: vi.fn() },
    browser_back: { execute: vi.fn() },
  } as unknown as ReturnType<typeof browserTools>
  const run = await runBoundedBrowserTask({
    task: { id: 'stale', goal: 'Press Go', startUrl: 'http://127.0.0.1/x', values: {} },
    session, tools, toolContext: {} as never,
    provider: new MockActionProvider([/Click the button "Go"/, /Click the button "Go"/, 'done']),
    verify: async () => 'verified',
  })
  expect(run.decisions.map((decision) => decision.outcome)).toEqual(['rejected_stale', 'executed', 'executed'])
  expect(click).toHaveBeenCalledTimes(1)
  expect(click.mock.calls[0]![0]).toEqual({ ref: 'e2' })
  expect(run.outcome).toBe('verified')
  expect(run.steps).toBe(1)
})

it('rejects a typing candidate that carries no application-owned value', async () => {
  const snapshot = '- textbox "Name" [ref=e1]'
  const session = { snapshot: async () => snapshot, location: async () => ({ url: 'http://127.0.0.1/x', title: 'x' }) } as unknown as BrowserSession
  const type = vi.fn()
  const tools = {
    browser_navigate: { execute: vi.fn(async () => snapshot) },
    browser_click: { execute: vi.fn() }, browser_type: { execute: type }, browser_back: { execute: vi.fn() },
  } as unknown as ReturnType<typeof browserTools>
  const provider = { decide: async () => ({ choice: 'c1', probabilities: { c1: 1 }, confidence: 1, goalAchieved: 0, model: 'fake', usage: { input_tokens: 0, output_tokens: 0 } }) }
  const run = await runBoundedBrowserTask({
    task: { id: 'no-value', goal: 'Type a name', startUrl: 'http://127.0.0.1/x', values: {} },
    session, tools, toolContext: {} as never, provider, verify: async () => 'refuted', typing: { kind: 'model-text' },
  })
  expect(run.outcome).toBe('abstained')
  expect(run.reason).toBe('no_progress')
  expect(run.postcondition).toBe('refuted')
  expect(run.decisions.map((decision) => decision.outcome)).toEqual(['rejected_unknown', 'rejected_unknown'])
  expect(type).not.toHaveBeenCalled()
})

async function runFixtureTask(task: FixtureTask) {
  const site = await startBrowserFixture()
  const f = await fixture(), browser = new BrowserService(f.directory)
  const turn = (await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: task.id })).turns[0]!
  const session = browser.session(turn.id, new TurnEventRecorder(f.db, undefined, turn.id, f.roomId))
  try {
    return await runBoundedBrowserTask({
      task: { ...task, startUrl: new URL(task.startUrl, site.baseUrl).toString() },
      session, tools: browserTools(session),
      toolContext: { toolCallId: task.id, messages: [], context: { turnId: turn.id, roomId: f.roomId, botId: f.botId, handoffDepth: 0 } } as never,
      provider: new MockActionProvider(task.mock),
      verify: async () => task.verify(site.state()),
    })
  } finally { await session.close(); await browser.close(); await site.close(); await f.close() }
}

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('drives the loopback fixture to each expected outcome without a network model', async () => {
  const greet = await runFixtureTask(BROWSER_TASKS.find((task) => task.id === 'greet')!)
  expect([greet.outcome, greet.steps, greet.mutations]).toEqual(['verified', 2, 2])

  const account = await runFixtureTask(BROWSER_TASKS.find((task) => task.id === 'already-subscribed')!)
  expect(account.outcome).toBe('verified')
  expect(account.mutations).toBe(0)
  expect(account.steps).toBe(0)

  const upload = await runFixtureTask(BROWSER_TASKS.find((task) => task.id === 'upload')!)
  expect(upload.outcome).toBe('abstained')
  expect(upload.reason).toBe('model_abstained')
  expect(upload.postcondition).toBe('verified')
  expect(upload.mutations).toBe(0)
  expect(JSON.stringify(upload)).not.toContain('Upload a file')
}, 120_000)

const SHADOW_PAGE = `- textbox "Email" [ref=e1]
- checkbox "I agree" [ref=e2]
- button "Subscribe" [ref=e3]`
const shadowContext = { roomId: 'room_a', turnId: 'turn_a', botId: 'bot_a', toolCallId: 'call_a' }
const decision = (over: Partial<ActionDecision> = {}): ActionDecision =>
  ({ choice: 'c3', probabilities: { c1: 0.05, c2: 0.15, c3: 0.8 }, confidence: 0.9, goalAchieved: 0.1, model: 'jev-test', usage: { input_tokens: 700, output_tokens: 9 }, ...over })

function shadow(provider: ActionDecisionProvider, options: { minConfidence?: number; roomIds?: ReadonlySet<string> } = {}) {
  const recorded: BrowserActionObservation[] = []
  const experiment = new BrowserActionExperiment(provider, { ...options, record: async (_context, observation) => { recorded.push(observation) } })
  const observe = (toolName: 'browser_click' | 'browser_type' | 'browser_back', toolInput: unknown) =>
    experiment.observe({ context: shadowContext, goal: 'Subscribe with the provided email', url: 'http://127.0.0.1/newsletter', title: 'Newsletter', snapshot: SHADOW_PAGE, step: 0, toolName, toolInput })
  return { experiment, recorded, observe }
}

it('maps a real tool call onto the candidate table without recording text or selectors', async () => {
  expect(baselineBrowserAction('browser_click', { ref: 'e3' })).toEqual({ kind: 'click', ref: 'e3', viaSelector: false })
  expect(baselineBrowserAction('browser_type', { ref: 'e1', text: 'secret@example.com' })).toEqual({ kind: 'type', ref: 'e1', viaSelector: false })
  expect(baselineBrowserAction('browser_back', {})).toEqual({ kind: 'back', ref: null, viaSelector: false })
  expect(baselineBrowserAction('browser_click', { selector: '#pay' })).toEqual({ kind: 'click', ref: null, viaSelector: true })

  const states: ActionDecisionState[] = []
  const { recorded, observe, experiment } = shadow({ decide: async (state) => { states.push(state); return decision() } })
  observe('browser_click', { ref: 'e3' })
  await experiment.drain()
  observe('browser_type', { ref: 'e1', text: 'secret@example.com' })
  await experiment.drain()
  expect(recorded[0]).toMatchObject({
    experiment: 'jev-browser-shadow', mode: 'shadow', questionVersion: 'browser-actions-v1', toolName: 'browser_click',
    baseline: { kind: 'click', ref: 'e3', viaSelector: false }, agrees: true,
    jev: { choice: 'c3', baselineProbability: 0.8, baselineRank: 1, candidates: 7, truncated: false, lowConfidence: false, inputTokens: 700 },
  })
  expect(recorded[1]).toMatchObject({ toolName: 'browser_type', baseline: { kind: 'type', ref: 'e1' }, agrees: false, jev: { baselineProbability: 0.05, baselineRank: 3 } })
  expect(JSON.stringify(recorded)).not.toContain('secret@example.com')
  expect(states[1]!.history).toEqual([{ id: 'baseline', description: 'Click the button "Subscribe"', outcome: 'executed' }])
  expect(states[0]!.candidates.map((candidate) => candidate.id)).toEqual(['c1', 'c2', 'c3', 'back', 'reobserve', 'done', 'abstain'])
  expect(JSON.stringify(states)).not.toContain('secret@example.com')
  await experiment.close()
})

it('scores agreement, sentinels, selectors, and unknown refs without ever guessing', async () => {
  const cases: Array<[Parameters<ReturnType<typeof shadow>['observe']>[0], unknown, Partial<ActionDecision>, Partial<BrowserActionObservation>]> = [
    ['browser_click', { ref: 'e2' }, { choice: 'c3' }, { agrees: false }],
    ['browser_back', {}, { choice: 'back', probabilities: { back: 0.9 } }, { agrees: true, sentinel: 'back' }],
    ['browser_click', { ref: 'e3' }, { choice: 'abstain', probabilities: { abstain: 1 } }, { agrees: null, sentinel: 'abstain' }],
    ['browser_click', { ref: 'e3' }, { choice: 'reobserve', probabilities: { reobserve: 1 } }, { agrees: null, sentinel: 'reobserve' }],
    ['browser_click', { selector: '#pay' }, {}, { agrees: null }],
    ['browser_click', { ref: 'e9' }, {}, { agrees: false }],
  ]
  for (const [toolName, toolInput, answer, expected] of cases) {
    const { recorded, observe, experiment } = shadow({ decide: async () => decision(answer) })
    observe(toolName, toolInput)
    await experiment.drain()
    expect(recorded[0]).toMatchObject(expected)
    await experiment.close()
  }
  const selectorRun = shadow({ decide: async () => decision() })
  selectorRun.observe('browser_click', { selector: '#pay' })
  await selectorRun.experiment.drain()
  expect(selectorRun.recorded[0]!.jev).toMatchObject({ baselineProbability: null, baselineRank: null })
  expect(JSON.stringify(selectorRun.recorded)).not.toContain('#pay')
  const unknownRef = shadow({ decide: async () => decision() })
  unknownRef.observe('browser_click', { ref: 'e9' })
  await unknownRef.experiment.drain()
  expect(unknownRef.recorded[0]!.jev).toMatchObject({ baselineProbability: null, baselineRank: null })
  await Promise.all([selectorRun.experiment.close(), unknownRef.experiment.close()])
})

it('records provider failures and low confidence as fields, never as agreement', async () => {
  const failing = shadow({ decide: async () => { throw new DecisionServiceError('http_502') } })
  failing.observe('browser_click', { ref: 'e3' })
  await failing.experiment.drain()
  expect(failing.recorded[0]).toMatchObject({ agrees: null, jev: { error: 'http_502' } })
  await failing.experiment.close()

  const unsure = shadow({ decide: async () => decision({ confidence: 0.2 }) }, { minConfidence: 0.35 })
  unsure.observe('browser_click', { ref: 'e3' })
  await unsure.experiment.drain()
  expect(unsure.recorded[0]).toMatchObject({ agrees: true, jev: { lowConfidence: true, confidence: 0.2 } })
  await unsure.experiment.close()
})

it('limits observation to the configured rooms and stops on close', async () => {
  const scoped = shadow({ decide: async () => decision() }, { roomIds: new Set(['room_other']) })
  expect(scoped.experiment.applies('room_a')).toBe(false)
  scoped.observe('browser_click', { ref: 'e3' })
  await scoped.experiment.drain()
  expect(scoped.recorded).toEqual([])
  await scoped.experiment.close()

  const open = shadow({ decide: async () => decision() })
  await open.experiment.close()
  expect(open.experiment.applies('room_a')).toBe(false)
  open.observe('browser_click', { ref: 'e3' })
  await open.experiment.drain()
  expect(open.recorded).toEqual([])
})

it('appends observations to a private serialized log', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-browser-log-'))
  const file = path.join(directory, 'experiments', 'jev-browser-actions.jsonl')
  const observer = browserActionFileObserver(file)
  const observation = (choice: string): BrowserActionObservation => ({
    experiment: 'jev-browser-shadow', questionVersion: 'browser-actions-v1', mode: 'shadow', toolName: 'browser_click',
    baseline: { kind: 'click', ref: 'e3', viaSelector: false }, agrees: true,
    jev: { model: 'jev-test', elapsedMs: 12, choice, confidence: 0.9, lowConfidence: false, goalAchieved: 0.1, baselineProbability: 0.8, baselineRank: 1, candidates: 7, truncated: false, inputTokens: 700, outputTokens: 9 },
  })
  try {
    await Promise.all([observer(shadowContext, observation('c3')), observer(shadowContext, observation('c2'))])
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(lines.map((line) => line.jev.choice)).toEqual(['c3', 'c2'])
    expect(lines[0]).toMatchObject({ roomId: 'room_a', turnId: 'turn_a', botId: 'bot_a', toolCallId: 'call_a' })
    expect(lines[0].timestamp).toEqual(expect.any(String))
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

it('builds nothing when the experiment is off or keyless and hot swaps otherwise', async () => {
  const settings = { mode: 'shadow' as const, model: 'jev-test', timeoutMs: 2000, minConfidence: 0.35, roomIds: ['room_a'] }
  expect(browserActionExperimentFromSettings({ ...settings, mode: 'off' }, 'synthetic-test-key', '/tmp/jev')).toBeUndefined()
  expect(browserActionExperimentFromSettings(settings, undefined, '/tmp/jev')).toBeUndefined()
  expect(browserActionExperimentFromSettings(settings, '', '/tmp/jev')).toBeUndefined()
  const live = browserActionExperimentFromSettings(settings, 'synthetic-test-key', '/tmp/jev')!
  expect(live.applies('room_a')).toBe(true)
  expect(live.applies('room_b')).toBe(false)
  await live.close()

  const manager = new BrowserActionExperimentManager('/tmp/jev')
  expect(manager.get()).toBeUndefined()
  await manager.configure(settings, 'synthetic-test-key')
  const first = manager.get()!
  expect(first.applies('room_a')).toBe(true)
  await manager.configure({ ...settings, roomIds: ['room_b'] }, 'synthetic-test-key')
  expect(manager.get()).not.toBe(first)
  expect(manager.get()?.applies('room_b')).toBe(true)
  await manager.configure({ ...settings, mode: 'off' }, 'synthetic-test-key')
  expect(manager.get()).toBeUndefined()
  await manager.close()
})

it('observes a real tool call without delaying it, changing it, or letting a failure escape', async () => {
  const results: string[] = []
  const tools = {
    browser_navigate: { execute: async () => SHADOW_PAGE },
    browser_snapshot: { execute: async () => SHADOW_PAGE },
    browser_click: { execute: async (input: { ref: string }) => { results.push(input.ref); return `clicked ${input.ref}` } },
    browser_type: { execute: async () => SHADOW_PAGE },
    browser_back: { execute: async () => SHADOW_PAGE },
  } as unknown as ReturnType<typeof browserTools>
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const { experiment, recorded } = shadow({ decide: async () => { await blocked; throw new DecisionServiceError('http_500') } })
  const observed = observedBrowserTools(tools, {
    experiment, context: shadowContext, goal: 'Subscribe',
    session: { location: async () => ({ url: 'http://127.0.0.1/newsletter', title: 'Newsletter' }) } as never,
  })
  // No snapshot has been seen yet, so the first click is executed but not observed.
  expect(await observed.browser_click.execute!({ ref: 'e3' } as never, {} as never)).toBe('clicked e3')
  expect(await observed.browser_navigate.execute!({ url: 'http://127.0.0.1/newsletter' } as never, {} as never)).toBe(SHADOW_PAGE)
  expect(await observed.browser_click.execute!({ ref: 'e2' } as never, {} as never)).toBe('clicked e2')
  expect(results).toEqual(['e3', 'e2'])
  expect(recorded).toEqual([])
  release()
  await experiment.drain()
  expect(recorded).toHaveLength(1)
  expect(recorded[0]).toMatchObject({ toolName: 'browser_click', baseline: { ref: 'e2' }, agrees: null, jev: { error: 'http_500' } })
  expect(observed.browser_click.description).toBe(tools.browser_click.description)
  await experiment.close()
})

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('observes every browser mutation of a real turn without changing it', async () => {
  const f = await fixture(), browser = new BrowserService(f.directory)
  await f.db.update(bots).set({ approvalPolicy: 'auto' }).where(eq(bots.id, f.botId))
  const site = await startBrowserFixture()
  const answers: ActionDecision[] = [
    { choice: 'c1', probabilities: { c1: 0.9, c2: 0.05 }, confidence: 0.9, goalAchieved: 0.02, model: 'jev-test', usage: { input_tokens: 500, output_tokens: 7 } },
    { choice: 'abstain', probabilities: { abstain: 0.7 }, confidence: 0.7, goalAchieved: 0.1, model: 'jev-test', usage: { input_tokens: 520, output_tokens: 7 } },
  ]
  const states: ActionDecisionState[] = []
  const recorded: BrowserActionObservation[] = []
  const experiment = new BrowserActionExperiment(
    { decide: async (state) => { states.push(state); return answers[states.length - 1] ?? answers[1]! } },
    { record: async (_context, observation) => { recorded.push(observation) } },
  )
  const url = new URL('/greet', site.baseUrl).toString()
  let call = 0
  const model = new MockLanguageModelV3({ doStream: async () => {
    call++
    if (call === 1) return mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'c1', toolName: 'browser_navigate', input: JSON.stringify({ url }) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }])
    if (call === 2) return mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'c2', toolName: 'browser_type', input: JSON.stringify({ ref: 'e4', text: 'Ada Lovelace' }) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }])
    if (call === 3) return mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 'c3', toolName: 'browser_click', input: JSON.stringify({ ref: 'e5' }) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }])
    return textStream('Submitted the form.')
  } })
  const runtime = new AgentRuntime({ ...f, browser, contextMessages: 60, modelResolver: () => model, browserActionExperiment: () => experiment })
  try {
    await f.admission.post({ roomId: f.roomId, authorKind: 'user', authorId: f.userId, text: 'Fill in the greeting form with Ada Lovelace' })
    const turn = (await f.db.select().from(turns))[0]!
    expect(await runtime.run(turn)).toMatchObject({ kind: 'done', text: 'Submitted the form.' })
    await experiment.drain()
    expect(site.state().greet).toEqual({ name: 'Ada Lovelace' })
    expect(recorded.map((observation) => [observation.toolName, observation.agrees])).toEqual([['browser_type', true], ['browser_click', null]])
    expect(recorded[0]!.jev).toMatchObject({ choice: 'c1', baselineProbability: 0.9, baselineRank: 1 })
    expect(recorded[1]).toMatchObject({ sentinel: 'abstain' })
    expect(states.map((state) => state.step)).toEqual([0, 1])
    expect(states[0]!.goal).toBe('Fill in the greeting form with Ada Lovelace')
    expect(states[0]!.title).toBe('Greeting form')
    expect(states[1]!.history).toEqual([{ id: 'baseline', description: 'Type text into the textbox "Name"', outcome: 'executed' }])
    expect(JSON.stringify(recorded)).not.toContain('Ada Lovelace')
  } finally { await experiment.close(); await browser.close(); await site.close(); await f.close() }
}, 60_000)
