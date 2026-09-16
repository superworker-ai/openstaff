import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '@openstaff/shared'
import { browserHarness } from '../test/browser-harness.js'
import { textStream } from '../test/mock-model.js'

describe.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('Home browser flow', () => {
  it('shows the greeting, team, completed work, and bold digest bot name', async () => {
    const model = new MockLanguageModelV3({ doStream: textStream('The customer brief is ready.') })
    const h = await browserHarness({ modelResolver: () => model }), errors: string[] = []
    h.page.on('pageerror', (error) => errors.push(error.message))
    try {
      const signup = await h.context.request.post(`${h.url}/api/auth/signup`, { data: { name: 'Browser Owner', email: 'home-owner@example.test', password: 'browser-password123' } })
      expect(signup.ok()).toBe(true)
      const created = await h.context.request.post(`${h.url}/api/bots`, { data: { name: 'Drake', job: 'Researcher', instructions: 'Finish concise briefs.', avatar: { shape: 'circle', color: '#2E90FA' } } })
      expect(created.ok()).toBe(true)
      const { bot, room } = await created.json() as { bot: { id: string }; room: { id: string } }
      const sent = await h.context.request.post(`${h.url}/api/rooms/${room.id}/messages`, { data: { text: 'Finish the customer brief', attachments: [], clientRequestId: crypto.randomUUID() } })
      expect(sent.ok()).toBe(true)
      await vi.waitFor(async () => {
        const response = await h.context.request.get(`${h.url}/api/rooms/${room.id}/messages?limit=200`)
        const data = await response.json() as { messages: Message[] }
        expect(data.messages).toEqual(expect.arrayContaining([expect.objectContaining({ authorKind: 'bot', authorId: bot.id, text: 'The customer brief is ready.' })]))
      }, { timeout: 10_000 })

      await h.page.route('**/api/home/digest', (route) => route.fulfill({ json: { text: 'Since yesterday, **Drake** finished the customer brief.', generatedAt: new Date().toISOString(), source: 'model' } }))
      await h.page.goto(`${h.url}/`, { waitUntil: 'domcontentloaded' })
      await h.page.locator('body[data-hydrated="true"]').waitFor()
      const home = h.page.getByRole('main', { name: 'Home' })
      await home.getByRole('heading', { name: /^(Morning|Afternoon|Evening), Browser$/ }).waitFor()
      await home.getByRole('complementary', { name: 'Team' }).getByRole('link', { name: /Drake/ }).waitFor()
      await home.getByText('The customer brief is ready.', { exact: true }).waitFor()
      await home.getByRole('paragraph').filter({ hasText: 'Since yesterday' }).locator('b').filter({ hasText: /^Drake$/ }).waitFor()
      expect(errors).toEqual([])
    } finally { await h.stop() }
  }, 90_000)
})
