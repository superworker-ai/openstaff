import fs from 'node:fs/promises'
import path from 'node:path'
import { MockLanguageModelV3 } from 'ai/test'
import { expect, it, vi } from 'vitest'
import { createApplication } from '../app.js'
import { buildTurnPrompt } from '../agent/prompt.js'

it('uploads files with jailed paths, labels attachments, cancels once, and reports usage', async () => {
  const directory = await fs.mkdtemp(path.resolve('data-test-upload-'))
  const model = new MockLanguageModelV3({ doStream: (options) => new Promise((_resolve, reject) => { options.abortSignal?.throwIfAborted(); options.abortSignal?.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }) }) })
  const running = await createApplication({ config: { dataDir: directory }, modelResolver: () => model })
  let cookie = ''
  const request = async (url: string, method = 'GET', body?: unknown) => {
    const response = await running.app.request(url, { method, headers: { cookie, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) })
    return { response, data: await response.json() }
  }
  try {
    const signup = await request('/api/auth/signup', 'POST', { name: 'Owner', email: 'upload@example.com', password: 'password123' })
    cookie = signup.response.headers.get('set-cookie')!.split(';')[0]!
    const owner = cookie
    const writeThrough = vi.spyOn(running.dependencies.durable, 'writeThrough')
    const { data: bot } = await request('/api/bots', 'POST', { name: 'drake', job: 'Engineer', avatar: { shape: 'circle', color: '#2E90FA' }, approvalPolicy: 'auto' })
    const form = new FormData(); form.append('file', new File(['hello'], '../../hello.txt'))
    const uploaded = await request(`/api/rooms/${bot.room.id}/uploads`, 'POST', form)
    expect(uploaded.response.status).toBe(201)
    expect(uploaded.data.attachment.name).toBe('hello.txt')
    expect(writeThrough.mock.calls.at(-1)?.[1]).toMatch(new RegExp(`^uploads/${bot.room.id}/[a-f0-9-]+-hello\\.txt$`))
    const posted = await request(`/api/rooms/${bot.room.id}/messages`, 'POST', { text: '', attachments: [uploaded.data.attachment], clientRequestId: 'upload' })
    const turn = posted.data.turns[0]
    const prompt = await buildTurnPrompt(running.database.db, running.dependencies.computer, turn, 60)
    expect(prompt.messages[1]?.content).toContain(uploaded.data.attachment.path)
    await vi.waitFor(async () => expect((await request(`/api/rooms/${bot.room.id}/turns`)).data.turns[0].status).toBe('running'))
    const cancelled = await Promise.all([request(`/api/turns/${turn.id}/cancel`, 'POST'), request(`/api/turns/${turn.id}/cancel`, 'POST')])
    expect(cancelled.map((item) => item.response.status).sort()).toEqual([200, 409])
    expect((await request(`/api/rooms/${bot.room.id}/messages`)).data.messages.filter((message: { text: string }) => message.text === 'drake was stopped')).toHaveLength(1)
    expect((await request(`/api/rooms/${bot.room.id}/messages`, 'POST', { text: 'bad', attachments: [{ ...uploaded.data.attachment, path: '/workspace/../../secret' }], clientRequestId: 'bad' })).response.status).toBe(400)
    for (const path of ['/workspace/uploads/other-room/hello.txt', `/workspace/uploads/${bot.room.id}/nested/hello.txt`, '/workspace/bots/drake/MEMORY.md']) {
      expect((await request(`/api/rooms/${bot.room.id}/messages`, 'POST', { text: 'bad', attachments: [{ ...uploaded.data.attachment, path }], clientRequestId: crypto.randomUUID() })).response.status).toBe(400)
    }
    expect((await request('/api/usage')).data.usage[bot.bot.id].totalTokens).toBe(0)
    const maximum = new FormData(); maximum.append('file', new File([new Uint8Array(20 * 1024 ** 2)], '..\\maximum?.bin'))
    const accepted = await request(`/api/rooms/${bot.room.id}/uploads`, 'POST', maximum)
    expect(accepted.response.status).toBe(201)
    expect(accepted.data.attachment).toMatchObject({ name: 'maximum_.bin', size: 20 * 1024 ** 2 })
    writeThrough.mockClear()
    const large = new FormData(); large.append('file', new File([new Uint8Array(20 * 1024 ** 2 + 1)], 'large'))
    expect((await request(`/api/rooms/${bot.room.id}/uploads`, 'POST', large)).response.status).toBe(413)
    expect(writeThrough).not.toHaveBeenCalled()
    const other = await request('/api/auth/signup', 'POST', { name: 'Other', email: 'other-upload@example.com', password: 'password123' })
    cookie = other.response.headers.get('set-cookie')!.split(';')[0]!
    expect((await request(`/api/rooms/${bot.room.id}/uploads`, 'POST', form)).response.status).toBe(404)
    cookie = owner
    expect((await request('/api/computer/status')).data.provider).toBe('local')
  } finally { await running.close(); await fs.rm(directory, { recursive: true, force: true }) }
})
