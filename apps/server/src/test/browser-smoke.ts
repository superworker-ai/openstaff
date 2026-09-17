import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { MockLanguageModelV3 } from 'ai/test'
import type { PublicTurn, TurnEvent } from '@openstaff/shared'
import { startServer } from '../app.js'
import { mockStream, mockUsage, textStream } from './mock-model.js'

export async function browserSmoke(dataDir: string) {
  const pageServer = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>OpenStaff browser smoke</title><h1>Browser tools are ready</h1><p>Local page, mock model, real Chromium.</p>') })
  await new Promise<void>((resolve) => pageServer.listen(0, '127.0.0.1', resolve))
  const pageUrl = `http://127.0.0.1:${(pageServer.address() as { port: number }).port}`
  const call = (name: string, input: unknown) => mockStream([{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: name, toolName: name, input: JSON.stringify(input) }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage }])
  const model = new MockLanguageModelV3({ doStream: [call('browser_navigate', { url: pageUrl }), call('browser_screenshot', {}), textStream('I captured the local page.')] })
  const server = await startServer({ config: { dataDir, port: 0, authSignup: 'open' }, modelResolver: () => model })
  let cookie = ''
  async function request(url: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${server.url}${url}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (url.endsWith('/sign-up/email')) cookie = response.headers.get('set-cookie')!.split(';')[0]!
    if (!response.ok) throw new Error(`${url}: ${response.status}`)
    return response.json()
  }
  try {
    await request('/api/auth/sign-up/email', 'POST', { name: 'Smoke Owner', email: 'browser@example.com', password: 'password123' })
    const computer = await request('/api/computer/status')
    if (computer.provider !== 'local') await request('/api/workspace', 'PATCH', { computerDriver: 'local' })
    const bot = await request('/api/bots', 'POST', { name: 'drake', job: 'Engineer', avatar: { shape: 'circle', color: '#2E90FA' }, approvalPolicy: 'auto' })
    const posted = await request(`/api/rooms/${bot.room.id}/messages`, 'POST', { text: 'Navigate to the local page and take a screenshot', clientRequestId: 'browser-smoke' })
    const turnId = posted.turns[0].id
    let turn: PublicTurn | undefined
    const started = Date.now()
    do {
      turn = (await request(`/api/rooms/${bot.room.id}/turns`)).turns.find((item: PublicTurn) => item.id === turnId)
      if (turn && ['done', 'failed'].includes(turn.status)) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    } while (Date.now() - started < 30_000)
    if (turn?.status !== 'done') throw new Error(`Browser smoke turn did not finish: ${JSON.stringify(turn)}`)
    const events: TurnEvent[] = (await request(`/api/turns/${turnId}/events`)).events
    const screenshots = events.filter((event) => event.type === 'screenshot')
    if (screenshots.length < 2) throw new Error('Expected automatic and explicit screenshots')
    const screenshot = screenshots.at(-1)!, url = String(screenshot.payload.url)
    const response = await fetch(`${server.url}${url}`, { headers: { cookie } })
    if (response.status !== 200 || response.headers.get('content-type') !== 'image/jpeg') throw new Error('Screenshot endpoint failed')
    if ((await fetch(`${server.url}${url}`)).status !== 401) throw new Error('Screenshot must require authentication')
    const file = path.join(dataDir, url.replace('/api/', '')), bytes = (await fs.stat(file)).size
    const signup = await fetch(`${server.url}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Other', email: 'other@example.com', password: 'password123' }) })
    const other = signup.headers.get('set-cookie')!.split(';')[0]!
    if ((await fetch(`${server.url}${url}`, { headers: { cookie: other } })).status !== 404) throw new Error('Screenshot must require room membership')
    return { server: server.url, driver: (await request('/api/computer/status')).driver, turn: { id: turn.id, status: turn.status }, screenshot: screenshot.payload, screenshotCount: screenshots.length, file, bytes }
  } finally { await server.stop(); await new Promise<void>((resolve) => pageServer.close(() => resolve())) }
}
