import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Entirely local RFC 9728 / OAuth PKCE / MCP fixture, on an OS-assigned port. */
export async function fakeOAuthServer(options: { rootMetadata?: boolean; dcr?: boolean; unprotected?: boolean } = {}) {
  const requests: string[] = [], grants: URLSearchParams[] = [], registrations: unknown[] = []
  const toolCalls: unknown[] = []
  const codes = new Map<string, { challenge: string; redirect: string; client: string }>()
  let accessToken = 'access-initial', rejectTokens = false, url = ''
  const json = (res: ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  const body = async (req: IncomingMessage) => { let text = ''; for await (const chunk of req) text += String(chunk); return text }
  const server = createServer((req, res) => { void (async () => {
    const parsed = new URL(req.url!, url), pathname = parsed.pathname
    requests.push(`${req.method} ${pathname}`)
    if (pathname === '/.cursor-plugin/marketplace.json') return json(res, { name: 'test-marketplace', plugins: [{ name: 'gmail', source: './gmail' }] })
    if (pathname === '/gmail/.cursor-plugin/plugin.json') return json(res, { name: 'gmail', displayName: 'Gmail', mcpServers: 'mcp.json' })
    if (pathname === '/gmail/mcp.json') return json(res, { mcpServers: { Gmail: { type: 'http', url: `${url}/mcp/v1` } } })
    if (pathname.startsWith('/.well-known/oauth-protected-resource')) {
      if (options.unprotected || pathname !== (options.rootMetadata ? '/.well-known/oauth-protected-resource' : '/.well-known/oauth-protected-resource/mcp/v1')) return json(res, {}, 404)
      return json(res, { resource: `${url}/mcp/v1`, authorization_servers: [url], scopes_supported: ['mail.read', 'mail.write'] })
    }
    if (pathname === '/.well-known/oauth-authorization-server') return json(res, {
      issuer: url, authorization_endpoint: `${url}/authorize`, token_endpoint: `${url}/token`, ...(options.dcr ? { registration_endpoint: `${url}/register` } : {}),
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    })
    if (pathname === '/register') { registrations.push(JSON.parse(await body(req))); return json(res, { client_id: 'dynamic-client', token_endpoint_auth_method: 'none', redirect_uris: [] }, 201) }
    if (pathname === '/authorize') {
      if (parsed.searchParams.get('code_challenge_method') !== 'S256') return json(res, { error: 'PKCE S256 required' }, 400)
      const code = randomBytes(16).toString('hex'), redirect = parsed.searchParams.get('redirect_uri')!
      codes.set(code, { challenge: parsed.searchParams.get('code_challenge')!, redirect, client: parsed.searchParams.get('client_id')! })
      const callback = new URL(redirect)
      callback.searchParams.set('code', code); callback.searchParams.set('state', parsed.searchParams.get('state')!); callback.searchParams.set('iss', url)
      res.writeHead(302, { location: callback.href }); res.end(); return
    }
    if (pathname === '/token') {
      const params = new URLSearchParams(await body(req)); grants.push(params)
      if (params.get('grant_type') === 'refresh_token') {
        if (params.get('refresh_token') !== 'refresh-secret') return json(res, { error: 'invalid_grant' }, 400)
        accessToken = `access-refreshed-${grants.length}`
        return json(res, { access_token: accessToken, token_type: 'Bearer', expires_in: 3600 })
      }
      const code = codes.get(params.get('code') ?? '')
      if (!code || params.get('redirect_uri') !== code.redirect || params.get('client_id') !== code.client || createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url') !== code.challenge) return json(res, { error: 'invalid_grant' }, 400)
      codes.delete(params.get('code')!)
      return json(res, { access_token: accessToken, token_type: 'Bearer', refresh_token: 'refresh-secret', expires_in: 3600 })
    }
    if (pathname === '/mcp/v1') {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
      const message = JSON.parse(await body(req))
      if (message.method === 'tools/call') toolCalls.push(message.params)
      if (message.method === 'tools/call' && (rejectTokens || req.headers.authorization !== `Bearer ${accessToken}`)) {
        res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${url}/.well-known/oauth-protected-resource${options.rootMetadata ? '' : '/mcp/v1'}"` }); res.end('Expected OAuth 2 access token'); return
      }
      if (message.id === undefined) { res.writeHead(202); res.end(); return }
      const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fake-mail', version: '1' } }
        : message.method === 'tools/list' ? { tools: [{ name: 'read_mail', description: 'Read mail', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] }
          : { content: [{ type: 'text', text: 'Inbox: hello from fake OAuth' }] }
      return json(res, { jsonrpc: '2.0', id: message.id, result })
    }
    json(res, {}, 404)
  })().catch((error) => json(res, { error: String(error) }, 500)) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { url, requests, grants, registrations, toolCalls, expire: () => { accessToken = 'expired-token-no-longer-valid' }, reject: () => { rejectTokens = true }, stop: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}
export async function writeOAuthPlugin(directory: string, url: string, name = 'gmail') {
  const root = path.join(directory, `oauth-source-${name}`)
  await fs.mkdir(path.join(root, '.cursor-plugin'), { recursive: true })
  await fs.writeFile(path.join(root, '.cursor-plugin/plugin.json'), JSON.stringify({ name, displayName: name === 'gmail' ? 'Gmail' : name, mcpServers: { mcpServers: { Gmail: { type: 'http', url: `${url}/mcp/v1` } } } }))
  return root
}
