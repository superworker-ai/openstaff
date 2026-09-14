import fs from 'node:fs/promises'
import path from 'node:path'
import WebSocket from 'ws'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, describe, expect, it } from 'vitest'
import type { PublicTurn, ServerWireMessage } from '@openstaff/shared'
import { startServer, type RunningServer } from '../app.js'
import { objectResult, textStream } from '../test/mock-model.js'

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!await predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('group room flow', () => {
  let running: RunningServer | undefined
  let directory = ''
  let socket: WebSocket | undefined
  afterEach(async () => {
    socket?.close()
    if (running) await running.stop()
    if (directory) await fs.rm(directory, { recursive: true, force: true })
  })

  it('runs a mentioned bot, skips the optional bot, and broadcasts events', async () => {
    directory = await fs.mkdtemp(path.resolve('data-test-integration-'))
    const model = new MockLanguageModelV3({
      doGenerate: objectResult({ reply: false, reason: 'Not my lane' }),
      doStream: textStream('Hello from Bot One.'),
    })
    running = await startServer({ config: { dataDir: directory, port: 0 }, modelResolver: () => model })
    const signup = await fetch(`${running.url}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Owner', email: 'owner@example.com', password: 'password123' }) })
    expect(signup.status).toBe(201)
    const cookie = signup.headers.get('set-cookie')!.split(';')[0]!
    const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${running!.url}${url}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...init?.headers } })
      expect(response.ok).toBe(true)
      return response.json() as Promise<T>
    }
    const first = await request<{ bot: { id: string } }>('/api/bots', { method: 'POST', body: JSON.stringify({ name: 'Bot One', job: 'Lead', instructions: '', avatar: { shape: 'circle', color: '#2E90FA' }, approvalPolicy: 'auto' }) })
    const second = await request<{ bot: { id: string } }>('/api/bots', { method: 'POST', body: JSON.stringify({ name: 'Bot Two', job: 'Support', instructions: '', avatar: { shape: 'blob', color: '#EE46BC' }, approvalPolicy: 'auto' }) })
    const group = await request<{ room: { id: string } }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Launch', botIds: [first.bot.id, second.bot.id], userIds: [] }) })
    const events: ServerWireMessage[] = []
    socket = new WebSocket(running.url.replace('http', 'ws') + '/ws', { headers: { cookie } })
    await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject) })
    socket.on('message', (value) => events.push(JSON.parse(value.toString()) as ServerWireMessage))
    socket.send(JSON.stringify({ type: 'subscribe', roomIds: [group.room.id] }))
    await waitFor(async () => events.some((event) => event.type === 'presence' && event.roomId === group.room.id))
    await request(`/api/rooms/${group.room.id}/messages`, { method: 'POST', body: JSON.stringify({ text: '@Bot One hello', clientRequestId: 'integration-message' }) })
    let roomTurns: PublicTurn[] = []
    await waitFor(async () => {
      roomTurns = (await request<{ turns: PublicTurn[] }>(`/api/rooms/${group.room.id}/turns`)).turns
      return roomTurns.length === 2 && roomTurns.every((turn) => ['done', 'skipped'].includes(turn.status))
    })
    expect(roomTurns.find((turn) => turn.botId === first.bot.id)).toMatchObject({ replyMode: 'direct', status: 'done' })
    expect(roomTurns.find((turn) => turn.botId === second.bot.id)).toMatchObject({ replyMode: 'optional', status: 'skipped' })
    const messageList = await request<{ messages: Array<{ authorKind: string; authorId: string | null; text: string }> }>(`/api/rooms/${group.room.id}/messages`)
    expect(messageList.messages).toContainEqual(expect.objectContaining({ authorKind: 'bot', authorId: first.bot.id, text: 'Hello from Bot One.' }))
    expect(events.some((event) => event.type === 'message.created')).toBe(true)
    expect(events.some((event) => event.type === 'turn.updated' && event.turn.status === 'done')).toBe(true)
  })
})
