import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import type { Bot, Message, PublicTurn, User } from '@openstaff/shared'
import type { Locator } from 'playwright'
import { browserHarness } from '../test/browser-harness.js'
import { mockStream, mockUsage, objectResult, textStream } from '../test/mock-model.js'

type Harness = Awaited<ReturnType<typeof browserHarness>>
const email = 'owner@example.test', password = 'browser-password123'

async function assertRoute(h: Harness, pathname: string, heading: string) {
  await h.page.waitForURL(`${h.url}${pathname}`, { waitUntil: 'domcontentloaded' })
  expect(new URL(h.page.url()).pathname).toBe(pathname)
  await h.page.getByRole('heading', { name: heading, exact: true }).waitFor()
  await h.page.locator('body[data-hydrated="true"]').waitFor()
}

async function signup(h: Harness) {
  await h.page.goto(`${h.url}/login`, { waitUntil: 'domcontentloaded' })
  await h.page.locator('body[data-hydrated="true"]').waitFor()
  await h.page.getByRole('link', { name: 'Create account', exact: true }).click()
  await h.page.getByPlaceholder('Your name').fill('Browser Owner')
  await h.page.getByPlaceholder('Email', { exact: true }).fill(email)
  await h.page.getByPlaceholder('Password', { exact: true }).fill(password)
  await h.page.getByRole('button', { name: 'Create account', exact: true }).click()
  await assertRoute(h, '/bots/new', 'Meet a future teammate')
}

async function createBot(h: Harness, name: string) {
  await assertRoute(h, '/bots/new', 'Meet a future teammate')
  await h.page.getByRole('button', { name: /Engineer/ }).click()
  expect(await h.page.getByPlaceholder('One clear line').inputValue()).toBe('Software engineer')
  await h.page.getByPlaceholder('e.g. Drake').fill(name)
  expect(await h.page.getByRole('combobox', { name: 'Approval policy' }).inputValue()).toBe('writes')
  await h.page.getByRole('button', { name: 'Create teammate' }).click()
  await h.page.waitForURL(/\/rooms\/room_[^/]+$/, { waitUntil: 'domcontentloaded' })
  const roomPath = new URL(h.page.url()).pathname
  await assertRoute(h, roomPath, name)
  await h.page.getByRole('navigation').getByRole('link', { name: new RegExp(name) }).waitFor()
  // Presence is the visible acknowledgement that the room's socket is subscribed.
  await h.page.getByRole('button', { name: 'Members' }).click()
  await h.page.getByText('present', { exact: true }).waitFor()
  await h.page.keyboard.press('Escape')
  await h.page.getByText('present', { exact: true }).waitFor({ state: 'detached' })
  return roomPath
}

// All state changes go through real forms. API reads only verify persisted results.
async function readApi<T>(h: Harness, pathname: string): Promise<T> {
  const response = await h.context.request.get(`${h.url}/api${pathname}`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<T>
}

function thread(h: Harness, name: string) {
  return h.page.locator('section').filter({ has: h.page.getByRole('heading', { name, exact: true }) })
}

async function assertBubble(side: 'left' | 'right', content: Locator, text: string) {
  const bubble = content.locator('.message-markdown').filter({ hasText: new RegExp(`^${text}$`) })
  await bubble.waitFor()
  const bounds = await bubble.boundingBox(), container = await content.boundingBox()
  expect(bounds).not.toBeNull(); expect(container).not.toBeNull()
  const center = bounds!.x + bounds!.width / 2, midpoint = container!.x + container!.width / 2
  if (side === 'right') expect(center).toBeGreaterThan(midpoint)
  else expect(center).toBeLessThan(midpoint)
  return bubble
}

describe.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('real browser UI flows', () => {
  it('signs up, creates a bot, chats, approves a write, and logs back into the last room', async () => {
    let releaseHello = () => {}, stream = 0
    const helloGate = new Promise<void>((resolve) => { releaseHello = resolve })
    const model = new MockLanguageModelV3({
      doGenerate: objectResult({ reply: false, reason: 'Nothing new to add' }),
      doStream: async () => {
        switch (stream++) {
          case 0: await helloGate; return textStream('Hello from Drake.')
          case 1: return mockStream([
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', toolCallId: 'write-call', toolName: 'write_file', input: JSON.stringify({ path: 'notes/hello.txt', content: 'Hello, world!' }) },
            { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage },
          ])
          case 2: return textStream('Saved your greeting.')
          default: throw new Error('Unexpected model call')
        }
      },
    })
    const h = await browserHarness({ modelResolver: () => model }), errors: string[] = []
    h.page.on('pageerror', (error) => errors.push(error.message))
    try {
      await signup(h)
      expect((await readApi<{ user: User }>(h, '/auth/get-session')).user.role).toBe('owner')
      const roomPath = await createBot(h, 'Drake'), content = thread(h, 'Drake')
      const composer = h.page.getByPlaceholder('Message Drake', { exact: true })
      await composer.fill('hello'); await composer.press('Enter')
      await assertBubble('right', content, 'hello')
      await content.getByText('is working…', { exact: false }).waitFor()
      await content.locator('[data-slot="bot-workstation"][data-state="working"]').waitFor()
      expect(await composer.inputValue()).toBe('')
      releaseHello()
      const reply = await assertBubble('left', content, 'Hello from Drake.')
      await reply.locator('..').getByText('Drake', { exact: true }).waitFor()
      await content.locator('[data-slot="bot-companion"]').waitFor()
      await assertRoute(h, roomPath, 'Drake')

      await composer.fill('Save a greeting file'); await composer.press('Enter')
      await content.getByText('Approval requested', { exact: true }).waitFor()
      await content.getByText('Write notes/hello.txt (13 bytes)', { exact: true }).waitFor()
      const file = path.join(h.api.config.dataDir, 'workspace/notes/hello.txt')
      await expect(fs.readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await content.getByRole('button', { name: 'Approve', exact: true }).click()
      await assertBubble('left', content, 'Saved your greeting.')
      expect(await fs.readFile(file, 'utf8')).toBe('Hello, world!')
      expect(await content.innerText()).not.toMatch(/write_file|tool-call|tool-result/)
      await assertRoute(h, roomPath, 'Drake')

      await h.page.getByRole('button', { name: 'Account menu' }).click()
      await h.page.getByRole('button', { name: 'Log out', exact: true }).click()
      await assertRoute(h, '/login', 'Log in')
      await h.page.getByPlaceholder('Email', { exact: true }).fill(email)
      await h.page.getByPlaceholder('Password', { exact: true }).fill(password)
      await h.page.locator('form').getByRole('button', { name: 'Log in', exact: true }).click()
      await h.page.waitForURL(`${h.url}/`, { waitUntil: 'domcontentloaded' })
      await h.page.getByRole('main', { name: 'Home' }).waitFor()
      await h.page.getByRole('navigation').getByRole('link', { name: 'Drake', exact: true }).click()
      await assertRoute(h, roomPath, 'Drake')
      await content.getByText('Saved your greeting.', { exact: true }).waitFor()
      expect(stream).toBe(3)
      expect(errors).toEqual([])
    } finally { releaseHello(); await h.stop() }
  }, 90_000)

  it('builds a persona and edits it', async () => {
    const h = await browserHarness(), errors: string[] = []
    h.page.on('pageerror', (error) => errors.push(error.message))
    try {
      await signup(h)
      await h.page.getByRole('button', { name: 'Personality: Gremlin', exact: true }).click()
      await h.page.getByRole('button', { name: 'Eyes: happy', exact: true }).click()
      await h.page.getByRole('button', { name: 'Accessory: glasses', exact: true }).click()
      await h.page.getByRole('button', { name: 'Color: #7A5AF8', exact: true }).click()
      await h.page.getByPlaceholder('e.g. Drake').fill('Pixel')
      await h.page.getByRole('button', { name: 'Create teammate', exact: true }).click()
      await h.page.waitForURL(/\/rooms\/room_[^/]+$/, { waitUntil: 'domcontentloaded' })
      expect((await readApi<{ bots: Bot[] }>(h, '/bots')).bots[0]?.avatar).toEqual({ shape: 'drop', color: '#7A5AF8', eyes: 'happy', mouth: 'smile', accessory: 'glasses', personality: 'gremlin' })
      await h.page.getByRole('link', { name: 'Settings', exact: true }).click()
      await assertRoute(h, '/settings', 'Workspace settings')
      await h.page.getByRole('link', { name: 'Bots', exact: true }).click()
      await h.page.getByRole('link', { name: 'Edit Pixel', exact: true }).click()
      await assertRoute(h, `/bots/${(await readApi<{ bots: Bot[] }>(h, '/bots')).bots[0]!.id}`, 'Edit teammate')
      await h.page.getByRole('button', { name: 'Mouth: grin', exact: true }).click()
      await h.page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await h.page.waitForURL(/\/rooms\/room_[^/]+$/, { waitUntil: 'domcontentloaded' })
      expect((await readApi<{ bots: Bot[] }>(h, '/bots')).bots[0]?.avatar.mouth).toBe('grin')
      await thread(h, 'Pixel').locator('header [data-slot="bot-avatar"][data-mouth="grin"]').waitFor()
      expect(errors).toEqual([])
    } finally { await h.stop() }
  }, 90_000)

  it('keeps two approval cards waiting until both writes are approved, including after reload', async () => {
    const model = new MockLanguageModelV3({ doStream: [mockStream([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'write_A', toolName: 'write_file', input: JSON.stringify({ path: 'notes/first.txt', content: 'first' }) },
      { type: 'tool-call', toolCallId: 'write_B', toolName: 'write_file', input: JSON.stringify({ path: 'notes/second.txt', content: 'second' }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: mockUsage },
    ]), textStream('Both files are ready.') ] })
    const h = await browserHarness({ modelResolver: () => model }), errors: string[] = []
    h.page.on('pageerror', (error) => errors.push(error.message))
    try {
      await signup(h)
      const roomPath = await createBot(h, 'Drake'), content = thread(h, 'Drake')
      const composer = h.page.getByPlaceholder('Message Drake', { exact: true })
      await composer.fill('Write both files'); await composer.press('Enter')
      await vi.waitFor(async () => expect(await content.getByText('Approval requested', { exact: true }).count()).toBe(2))
      const first = content.getByText('Write notes/first.txt (5 bytes)', { exact: true }).locator('..')
      const second = content.getByText('Write notes/second.txt (6 bytes)', { exact: true }).locator('..')
      expect(await content.locator('details').count()).toBe(2)
      expect((await first.boundingBox())!.y).toBeLessThan((await second.boundingBox())!.y)
      await first.getByRole('button', { name: 'Approve', exact: true }).click()
      await first.getByText('approved', { exact: true }).waitFor()
      await h.page.getByRole('button', { name: 'Members' }).click()
      await h.page.getByText('waiting approval', { exact: true }).waitFor()
      await h.page.getByRole('navigation').getByText('Drake needs approval', { exact: true }).waitFor()
      await h.page.keyboard.press('Escape')
      expect((await readApi<{ turns: PublicTurn[] }>(h, `${roomPath}/turns`)).turns[0]?.status).toBe('waiting_approval')
      expect(model.doStreamCalls).toHaveLength(1)
      for (const name of ['first', 'second']) await expect(fs.readFile(path.join(h.api.config.dataDir, `workspace/notes/${name}.txt`))).rejects.toMatchObject({ code: 'ENOENT' })
      await h.page.reload({ waitUntil: 'domcontentloaded' })
      await assertRoute(h, roomPath, 'Drake')
      await h.page.getByRole('button', { name: 'Members' }).click()
      await h.page.getByText('present', { exact: true }).waitFor()
      await first.getByText('approved', { exact: true }).waitFor()
      await h.page.getByText('waiting approval', { exact: true }).waitFor()
      await h.page.getByRole('navigation').getByText('Drake needs approval', { exact: true }).waitFor()
      await h.page.keyboard.press('Escape')
      await second.getByRole('button', { name: 'Approve', exact: true }).click()
      await assertBubble('left', content, 'Both files are ready.')
      await second.getByText('approved', { exact: true }).waitFor()
      for (const name of ['first', 'second']) expect(await fs.readFile(path.join(h.api.config.dataDir, `workspace/notes/${name}.txt`), 'utf8')).toBe(name)
      await vi.waitFor(async () => expect((await readApi<{ turns: PublicTurn[] }>(h, `${roomPath}/turns`)).turns[0]?.status).toBe('done'))
      expect(await content.innerText()).not.toMatch(/write_file|tool-call|Tool result is missing/)
      expect(model.doStreamCalls).toHaveLength(2)
      expect(errors).toEqual([])
    } finally { await h.stop() }
  }, 90_000)

  it('redirects root to login without a session and to bot creation with an empty workspace', async () => {
    const h = await browserHarness(), errors: string[] = []
    h.page.on('pageerror', (error) => errors.push(error.message))
    try {
      await h.page.goto(`${h.url}/`, { waitUntil: 'domcontentloaded' })
      await assertRoute(h, '/login', 'Log in')
      await signup(h)
      expect((await readApi<{ rooms: unknown[] }>(h, '/rooms')).rooms).toEqual([])
      // A full navigation exercises the cookie-forwarding SSR loader, too.
      await h.page.goto(`${h.url}/`, { waitUntil: 'domcontentloaded' })
      await assertRoute(h, '/bots/new', 'Meet a future teammate')
      expect(errors).toEqual([])
    } finally { await h.stop() }
  }, 90_000)

  it('creates a two-bot group through the dialog and only the mentioned bot replies', async () => {
    const model = new MockLanguageModelV3({ doGenerate: objectResult({ reply: false, reason: 'Drake already answered' }), doStream: textStream('Only Drake replies.') })
    const h = await browserHarness({ modelResolver: () => model }), errors: string[] = []
    h.page.on('pageerror', (error) => errors.push(error.message))
    try {
      await signup(h)
      const drakePath = await createBot(h, 'Drake')
      await h.page.getByRole('button', { name: 'Create', exact: true }).click()
      await h.page.getByRole('link', { name: 'New bot', exact: true }).click()
      const johnPath = await createBot(h, 'John')
      await h.page.getByRole('button', { name: 'Create', exact: true }).click()
      await h.page.getByRole('button', { name: 'New group', exact: true }).click()
      await h.page.getByRole('heading', { name: 'New group', exact: true }).waitFor()
      await h.page.getByRole('textbox', { name: 'Group name' }).fill('Launch team')
      await h.page.getByRole('button', { name: /Drake/ }).click()
      await h.page.getByRole('button', { name: /John/ }).click()
      await h.page.getByRole('button', { name: 'Create group', exact: true }).click()
      await h.page.waitForURL((url) => url.pathname.startsWith('/rooms/') && ![johnPath, drakePath].includes(url.pathname), { waitUntil: 'domcontentloaded' })
      const groupPath = new URL(h.page.url()).pathname
      await assertRoute(h, groupPath, 'Launch team')
      await h.page.getByRole('navigation').getByRole('link', { name: /Launch team/ }).waitFor()
      const composer = h.page.getByPlaceholder('Message Launch team', { exact: true }), content = thread(h, 'Launch team')
      await composer.fill('@Drake hi'); await composer.press('Enter')
      await assertBubble('right', content, '@Drake hi')
      await assertBubble('left', content, 'Only Drake replies.')
      const room = await readApi<{ room: { members: { memberId: string; entity: { name: string } }[] } }>(h, groupPath)
      const drakeId = room.room.members.find((member) => member.entity.name === 'Drake')!.memberId
      const johnId = room.room.members.find((member) => member.entity.name === 'John')!.memberId
      await vi.waitFor(async () => {
        const { turns } = await readApi<{ turns: PublicTurn[] }>(h, `${groupPath}/turns`)
        expect(turns).toHaveLength(2)
        expect(turns).toEqual(expect.arrayContaining([
          expect.objectContaining({ botId: drakeId, replyMode: 'direct', status: 'done' }),
          expect.objectContaining({ botId: johnId, replyMode: 'optional', status: 'skipped' }),
        ]))
      }, { timeout: 5000 })
      const { messages } = await readApi<{ messages: Message[] }>(h, `${groupPath}/messages`)
      expect(messages.filter((message) => message.authorKind === 'bot')).toEqual([expect.objectContaining({ authorId: drakeId, text: 'Only Drake replies.' })])
      expect(await content.locator('.message-markdown').count()).toBe(2)
      expect(await content.innerText()).not.toMatch(/tool-call|tool-result/)
      await assertRoute(h, groupPath, 'Launch team')
      expect(model.doStreamCalls).toHaveLength(1)
      expect(model.doGenerateCalls).toHaveLength(1)
      expect(errors).toEqual([])
    } finally { await h.stop() }
  }, 90_000)

  it('creates a schedule automation from a room template, runs it, and shows history', async () => {
    const h = await browserHarness(), errors: string[] = []
    h.page.on('pageerror', (error) => errors.push(error.message))
    try {
      await signup(h)
      await createBot(h, 'Drake')
      await h.page.getByRole('button', { name: 'Room settings', exact: true }).click()
      const dialog = h.page.getByRole('heading', { name: 'Room settings', exact: true }).locator('..').locator('..')
      await dialog.getByRole('button', { name: 'Daily standup', exact: true }).click()
      await dialog.getByRole('button', { name: 'Save automation', exact: true }).click()
      const row = dialog.locator('article').filter({ hasText: 'Daily standup' })
      await row.getByRole('button', { name: 'Run now', exact: true }).click()
      await row.getByRole('button', { name: 'History', exact: true }).click()
      await row.getByText(/manual ·/).waitFor()
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await h.page.locator('.message-markdown').filter({ hasText: /^Automation "Daily standup"/ }).waitFor()
      expect(errors).toEqual([])
    } finally { await h.stop() }
  }, 90_000)
})
