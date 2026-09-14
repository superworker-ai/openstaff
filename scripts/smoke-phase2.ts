import fs from 'node:fs/promises'
import path from 'node:path'
import { startServer } from '../apps/server/src/app.js'

await fs.mkdir(path.resolve('data'), { recursive: true })
const directory = await fs.mkdtemp(path.resolve('data/smoke-phase2-'))
for (const name of ['XAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AI_GATEWAY_API_KEY', 'COMPOSIO_API_KEY']) delete process.env[name]
const server = await startServer({ config: { dataDir: directory, port: 0 } })
let cookie = ''
async function request(url: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${server.url}${url}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (url === '/api/auth/signup') cookie = response.headers.get('set-cookie')!.split(';')[0]!
  const value = await response.json()
  if (!response.ok) throw new Error(`${method} ${url}: ${response.status} ${JSON.stringify(value)}`)
  return value
}
try {
  console.log(`Server booted on ${server.url}, temporary DATA_DIR, no provider keys`)
  await request('/api/auth/signup', 'POST', { name: 'Smoke Owner', email: 'phase2@example.com', password: 'password123', signupCode: process.env.SIGNUP_CODE })
  console.log('POST /api/auth/signup: 201')
  await request('/api/plugins/install', 'POST', { source: 'path:/tmp/refs/plugins/ralph-loop' })
  await request('/api/plugins/install', 'POST', { source: 'path:/tmp/refs/plugins/third_party/playwright' })
  const installed = await request('/api/plugins')
  console.log('GET /api/plugins:', JSON.stringify(installed.plugins.map((plugin: { name: string; skills: Array<{ name: string }>; hooks: { supported: boolean } | null; mcpServers: unknown }) => ({ name: plugin.name, skills: plugin.skills.map((skill) => skill.name), hooksSupported: plugin.hooks?.supported ?? null, mcpServers: plugin.mcpServers })), null, 2))
  const bot = await request('/api/bots', 'POST', { name: 'drake', job: 'Engineer', avatar: { shape: 'circle', color: '#2E90FA' } })
  const created = await request('/api/automations', 'POST', { name: 'Smoke check', trigger: 'schedule', cron: '* * * * *', timezone: 'UTC', prompt: 'Report status', targetBotIds: [bot.bot.id], roomId: bot.room.id })
  console.log('POST /api/automations:', JSON.stringify(created.automation, null, 2))
  const started = Date.now()
  let found = false
  while (Date.now() - started < 65_000) {
    const messages = await request(`/api/rooms/${bot.room.id}/messages`)
    const turns = await request(`/api/rooms/${bot.room.id}/turns`)
    if (turns.turns.some((turn: { status: string }) => turn.status === 'failed') && messages.messages.length >= 2) {
      console.log(`Cron tick observed after ${((Date.now() - started) / 1000).toFixed(1)}s`)
      console.log('Messages:', JSON.stringify(messages.messages.map(({ authorKind, text, seq }: { authorKind: string; text: string; seq: number }) => ({ seq, authorKind, text })), null, 2))
      console.log('Turns:', JSON.stringify(turns.turns.map(({ id, replyMode, status, error }: { id: string; replyMode: string; status: string; error: string }) => ({ id, replyMode, status, error })), null, 2))
      found = true; break
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!found) throw new Error('No cron turn observed within 65 seconds')
} finally {
  await server.stop()
  await fs.rm(directory, { recursive: true, force: true })
  console.log('Server stopped; temporary DATA_DIR removed.')
}
