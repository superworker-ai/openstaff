import type { BrowserActionContext, BrowserActionExperiment, ObservedBrowserTool } from './jev-actions.js'
import type { BrowserSession } from './service.js'
import type { browserTools } from './tools.js'

type BrowserToolset = ReturnType<typeof browserTools>
type AnyTool = { execute?: (...args: any[]) => any }

function wrapTool<T extends AnyTool>(subject: T, before: (input: unknown) => void, after: (result: unknown) => void): T {
  const original = subject.execute
  if (!original) return subject
  return { ...subject, execute: async (input: never, context: never) => { before(input); const result = await original(input, context); after(result); return result } } as T
}

/**
 * Wraps the browser tools for one turn so the shadow experiment sees the page the model saw. Tool
 * descriptions, schemas, approval behaviour, and return values are untouched, and the observation is
 * started before the real call and never awaited.
 */
export function observedBrowserTools(tools: BrowserToolset, input: {
  experiment: BrowserActionExperiment
  context: BrowserActionContext
  goal: string
  session: BrowserSession
  signal?: AbortSignal
}): BrowserToolset {
  let snapshot = ''
  let step = 0
  // Page identity is resolved off the tool's critical path, so observation adds no latency to a turn.
  let location = Promise.resolve({ url: '', title: '' })
  const remember = (result: unknown) => {
    if (typeof result !== 'string') return
    snapshot = result
    location = input.session.location().catch(() => ({ url: '', title: '' }))
  }
  const observe = (toolName: ObservedBrowserTool) => (toolInput: unknown) => {
    if (!snapshot) return
    // Captured here so the observation always describes the page as it was before this call.
    const page = snapshot, at = step, where = location
    step++
    void where.then((place) => {
      try {
        input.experiment.observe({ context: input.context, goal: input.goal, url: place.url, title: place.title, snapshot: page, step: at, toolName, toolInput, signal: input.signal })
      } catch { /* Shadow telemetry must never break a tool call. */ }
    }, () => undefined)
  }
  const ignore = () => undefined
  return {
    ...tools,
    browser_navigate: wrapTool(tools.browser_navigate, ignore, remember),
    browser_snapshot: wrapTool(tools.browser_snapshot, ignore, remember),
    browser_click: wrapTool(tools.browser_click, observe('browser_click'), remember),
    browser_type: wrapTool(tools.browser_type, observe('browser_type'), remember),
    browser_back: wrapTool(tools.browser_back, observe('browser_back'), remember),
  }
}
