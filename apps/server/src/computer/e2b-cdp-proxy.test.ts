import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { E2B_CDP_NODE_PROXY } from './e2b-cdp-proxy.js'

const children: ReturnType<typeof spawn>[] = []
const servers: ReturnType<typeof createServer>[] = []

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  const port = await listen(server)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  servers.splice(servers.indexOf(server), 1)
  return port
}

afterEach(async () => {
  for (const child of children) child.kill()
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  vi.restoreAllMocks()
})

it('forwards Chrome HTTP with a loopback Host and rewrites debugger WebSocket URLs', async () => {
  let receivedHost = ''
  const chromePort = await listen(createServer((request, response) => {
    receivedHost = request.headers.host ?? ''
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://localhost:9223/devtools/browser/test', alternate: 'ws://127.0.0.1:9223/devtools/page/test' }))
  }))
  const proxyPort = await unusedPort()
  const child = spawn(process.execPath, ['--input-type=module', '--eval', E2B_CDP_NODE_PROXY], {
    env: { ...process.env, LISTEN_PORT: String(proxyPort), TARGET_PORT: String(chromePort), PUBLIC_HOST: 'sandbox-9222.e2b.test' },
    stdio: 'ignore',
  })
  children.push(child)

  let response: Response | undefined
  await vi.waitFor(async () => {
    response = await fetch(`http://127.0.0.1:${proxyPort}/json/version`).catch(() => undefined)
    expect(response?.ok).toBe(true)
  }, { timeout: 5000, interval: 50 })
  expect(receivedHost).toBe(`localhost:${chromePort}`)
  await expect(response!.json()).resolves.toEqual({
    webSocketDebuggerUrl: 'wss://sandbox-9222.e2b.test/devtools/browser/test',
    alternate: 'wss://sandbox-9222.e2b.test/devtools/page/test',
  })
})
