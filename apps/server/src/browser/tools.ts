import { tool } from 'ai'
import { z } from 'zod'
import { toolContextSchema } from '../agent/tools.js'
import type { BrowserSession } from './service.js'

const target = z.object({ ref: z.string().optional(), selector: z.string().optional() }).refine((input) => Boolean(input.ref || input.selector), 'Provide ref or selector')
export const browserToolSchemas = {
  navigate: z.object({ url: z.url().refine((value) => /^https?:\/\//.test(value), 'Use HTTP or HTTPS'), newTab: z.boolean().optional() }),
}

export function browserTools(session: BrowserSession) {
  const safe = async <T>(operation: () => Promise<T>, newTab = false): Promise<T | { error: string }> => {
    try { return await session.run(operation, newTab) } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }
  const locator = async ({ ref, selector }: { ref?: string; selector?: string }) => {
    if (ref && !/^e\d+$/.test(ref)) throw new Error('Invalid ref; take a fresh browser_snapshot')
    return (await session.getPage()).locator(ref ? `aria-ref=${ref}` : selector!)
  }
  return {
    browser_navigate: tool({ description: 'Navigate the shared browser to an HTTP(S) URL. Reuses the tab currently on screen; pass newTab: true to open a fresh tab when the current one must stay as it is (a logged-in app, a QR code, a form in progress).', contextSchema: toolContextSchema, inputSchema: browserToolSchemas.navigate, execute: ({ url, newTab }) => safe(async () => { await (await session.getPage()).goto(url, { waitUntil: 'domcontentloaded' }); await session.screenshot(true); return session.snapshot() }, newTab) }),
    browser_snapshot: tool({ description: 'Get a capped ARIA tree with refs for click/type. Refresh after navigation.', contextSchema: toolContextSchema, inputSchema: z.object({}), execute: () => safe(() => session.snapshot()) }),
    browser_click: tool({ description: 'Click an element by snapshot ref or selector.', contextSchema: toolContextSchema, inputSchema: target, execute: (input) => safe(async () => { await (await locator(input)).click(); await session.screenshot(true); return session.snapshot() }) }),
    browser_type: tool({ description: 'Fill an input by ref or selector, optionally submit with Enter.', contextSchema: toolContextSchema, inputSchema: target.safeExtend({ text: z.string(), submit: z.boolean().optional() }), execute: (input) => safe(async () => { const element = await locator(input); await element.fill(input.text); if (input.submit) await element.press('Enter'); await session.screenshot(true); return session.snapshot() }) }),
    browser_screenshot: tool({ description: 'Save a JPEG screenshot to the Computer panel.', contextSchema: toolContextSchema, inputSchema: z.object({}), execute: () => safe(() => session.screenshot()) }),
    browser_back: tool({ description: 'Go back in this page history.', contextSchema: toolContextSchema, inputSchema: z.object({}), execute: () => safe(async () => { await (await session.getPage()).goBack({ waitUntil: 'domcontentloaded' }); await session.screenshot(true); return session.snapshot() }) }),
  }
}
