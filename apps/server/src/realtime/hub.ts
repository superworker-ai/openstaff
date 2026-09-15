import type { IncomingMessage } from 'node:http'
import { and, eq, gt } from 'drizzle-orm'
import type { Server as HttpServer } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { clientWireMessageSchema, SESSION_COOKIE, type ComputerLease, type ServerWireMessage, type User, type WorkspaceState } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { roomMembers, sessions, users } from '../db/schema.js'
import { publicUser } from '../auth/session.js'
import { DESKTOP_PREFIX, desktopAuthorization, desktopStreamReady, desktopTarget, type DesktopMode } from '../api/computer-desktop.js'
import { originAllowed } from '../api/origin.js'
import type { DesktopEndpoints } from '../computer/types.js'
import type { ComputerLeaseSource } from '../computer/lease.js'

interface ClientState {
  user: User
  roomIds: Set<string>
}

function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries((header ?? '').split(';').map((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return ['', '']
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]
  }).filter(([key]) => key))
}

export class RealtimeHub {
  private readonly clients = new Map<WebSocket, ClientState>()
  private readonly socketServer = new WebSocketServer({ noServer: true })
  private readonly desktopSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false })
  private readonly desktopStreams = new Map<WebSocket, { userId: string; mode: 'viewer' | 'control' }>()
  private pendingDesktopStreams = 0
  private lease?: ComputerLeaseSource
  private unsubscribeLease?: () => void

  constructor(private readonly db: Database, private readonly desktop?: () => Promise<DesktopEndpoints | null>, private readonly publicAppUrl?: string, private readonly workspaceState: WorkspaceState = 'active') {}

  setLease(lease: ComputerLeaseSource): void {
    this.unsubscribeLease?.()
    this.lease = lease
    this.unsubscribeLease = lease.onChange((current) => this.closeStaleControlStreams(current))
  }

  private closeStaleControlStreams(lease: ComputerLease): void {
    for (const [socket, stream] of this.desktopStreams) {
      if (stream.mode === 'control' && (lease.ownerKind !== 'human' || lease.ownerId !== stream.userId)) socket.close(4001, 'lease changed')
    }
  }

  attach(server: HttpServer): void {
    server.on('upgrade', async (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (this.workspaceState === 'suspended' && (url.pathname === '/ws' || url.pathname.startsWith('/api/'))) return this.rejectUpgrade(socket, 402, 'Workspace suspended', 'suspended')
      if (url.pathname === DESKTOP_PREFIX || url.pathname.startsWith(`${DESKTOP_PREFIX}/`)) {
        await this.upgradeDesktop(request, socket, head)
        return
      }
      if (url.pathname !== '/ws') return
      const user = await this.authenticate(request)
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      this.socketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.connected(webSocket, request, user)
      })
    })
  }

  private expectedOrigin(request: IncomingMessage): string | null {
    if (this.publicAppUrl) {
      try { return new URL(this.publicAppUrl).origin } catch { return null }
    }
    const forwardedHost = Array.isArray(request.headers['x-forwarded-host']) ? request.headers['x-forwarded-host'][0] : request.headers['x-forwarded-host']
    const host = forwardedHost?.split(',')[0]?.trim() || request.headers.host
    if (!host) return null
    const forwardedProtocol = Array.isArray(request.headers['x-forwarded-proto']) ? request.headers['x-forwarded-proto'][0] : request.headers['x-forwarded-proto']
    const protocol = forwardedProtocol?.split(',')[0]?.trim() || ((request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http')
    return `${protocol}://${host}`
  }

  private rejectUpgrade(socket: import('node:stream').Duplex, status: 401 | 402 | 403 | 409 | 429 | 503, reason: string, code?: string) {
    const statusText = status === 402 ? 'Payment Required' : reason
    socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ error: reason, ...(code ? { code } : {}) })}`)
    socket.destroy()
  }

  private async upgradeDesktop(request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): Promise<void> {
    const user = await this.authenticate(request)
    if (!user) return this.rejectUpgrade(socket, 401, 'Authentication required')
    const expectedOrigin = this.expectedOrigin(request) ?? 'http://localhost'
    if (!originAllowed(request.headers.origin, { publicAppUrl: this.publicAppUrl, headers: request.headers, requestUrl: new URL(request.url ?? '/', expectedOrigin).toString(), encrypted: Boolean((request.socket as { encrypted?: boolean }).encrypted) })) return this.rejectUpgrade(socket, 403, 'Origin not allowed')
    if (!this.desktop || this.desktopStreams.size + this.pendingDesktopStreams >= 4) return this.rejectUpgrade(socket, 429, 'Desktop stream limit reached')

    this.pendingDesktopStreams += 1
    try {
      const requestedControl = new URL(request.url ?? '/', expectedOrigin).searchParams.get('mode') === 'control'
      const current = requestedControl ? await this.lease?.current() : null
      const controls = requestedControl && current?.ownerKind === 'human' && current.ownerId === user.id
      let streamMode = controls ? 'control' as const : 'viewer' as const
      let authorizationMode = controls ? 'controller' as const : 'viewer' as const
      const desktop = await this.desktop()
      if (desktop?.kind === 'external') return this.rejectUpgrade(socket, 409, 'external-stream')
      if (!desktop || !await desktopStreamReady(desktop, authorizationMode)) return this.rejectUpgrade(socket, 503, 'Computer desktop unavailable')
      const target = desktopTarget(desktop.streamUrl, new URL(request.url ?? '/', expectedOrigin).toString())
      target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
      const requestedProtocols = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map((value) => value.trim()).filter(Boolean)
      const openUpstream = async (mode: DesktopMode) => {
        const options = { headers: { authorization: desktopAuthorization(desktop, mode) }, handshakeTimeout: 5000, maxPayload: 1024 * 1024, perMessageDeflate: false }
        const upstream = requestedProtocols.length ? new WebSocket(target, requestedProtocols, options) : new WebSocket(target, options)
        const opened = await new Promise<boolean>((resolve) => {
          upstream.once('open', () => resolve(true))
          upstream.once('error', () => resolve(false))
        })
        if (!opened) { upstream.terminate(); return null }
        return upstream
      }
      let upstream = await openUpstream(authorizationMode)
      if (!upstream) return this.rejectUpgrade(socket, 503, 'Computer desktop unavailable')
      if (controls) {
        const latest = await this.lease?.current()
        if (latest?.ownerKind !== 'human' || latest.ownerId !== user.id) {
          upstream.terminate()
          streamMode = 'viewer'
          authorizationMode = 'viewer'
          upstream = await openUpstream(authorizationMode)
          if (!upstream) return this.rejectUpgrade(socket, 503, 'Computer desktop unavailable')
        }
      }

      this.desktopSocketServer.handleUpgrade(request, socket, head, (client) => {
        this.desktopStreams.set(client, { userId: user.id, mode: streamMode })
        if (streamMode === 'control') void this.lease?.current().then((latest) => this.closeStaleControlStreams(latest), () => client.close(4001, 'lease changed'))
        const close = (peer: WebSocket, code: number, reason: Buffer) => {
          const sendableCode = [1005, 1006, 1015].includes(code) ? 1000 : code
          if (peer.readyState === WebSocket.OPEN || peer.readyState === WebSocket.CONNECTING) peer.close(sendableCode, reason.toString().slice(0, 123))
        }
        client.on('message', (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }) })
        upstream.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }) })
        client.on('close', (code, reason) => { this.desktopStreams.delete(client); close(upstream, code, reason) })
        upstream.on('close', (code, reason) => { this.desktopStreams.delete(client); close(client, code, reason) })
        client.on('error', () => upstream.terminate())
        upstream.on('error', () => client.terminate())
      })
    } catch { this.rejectUpgrade(socket, 503, 'Computer desktop unavailable') }
    finally { this.pendingDesktopStreams -= 1 }
  }

  private async authenticate(request: IncomingMessage): Promise<User | null> {
    const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE]
    if (!sessionId) return null
    const row = (await this.db.select({ user: users }).from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date().toISOString())))
      .limit(1))[0]
    return row ? publicUser(row.user) : null
  }

  private connected(socket: WebSocket, _request: IncomingMessage, user: User): void {
    this.clients.set(socket, { user, roomIds: new Set() })
    socket.on('message', async (value) => {
      let parsed: unknown
      try { parsed = JSON.parse(value.toString()) } catch { return }
      const result = clientWireMessageSchema.safeParse(parsed)
      if (!result.success) return
      if (result.data.type === 'ping') {
        this.send(socket, { type: 'pong', ts: new Date().toISOString() })
        return
      }
      const allowed = new Set((await this.db.select({ roomId: roomMembers.roomId }).from(roomMembers)
        .where(and(eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, user.id)))).map((row) => row.roomId))
      const state = this.clients.get(socket)
      if (!state) return
      const previous = new Set(state.roomIds)
      state.roomIds = new Set(result.data.roomIds.filter((id) => allowed.has(id)))
      const changed = new Set([...previous, ...state.roomIds])
      for (const roomId of changed) this.broadcastPresence(roomId)
    })
    socket.on('close', () => {
      const state = this.clients.get(socket)
      this.clients.delete(socket)
      for (const roomId of state?.roomIds ?? []) this.broadcastPresence(roomId)
    })
  }

  private send(socket: WebSocket, message: ServerWireMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  broadcastRoom(roomId: string, message: ServerWireMessage): void {
    for (const [socket, state] of this.clients) {
      if (state.roomIds.has(roomId)) this.send(socket, message)
    }
  }

  broadcastAll(message: ServerWireMessage): void {
    for (const socket of this.clients.keys()) this.send(socket, message)
  }

  private broadcastPresence(roomId: string): void {
    const unique = new Map<string, { id: string; name: string }>()
    for (const state of this.clients.values()) {
      if (state.roomIds.has(roomId)) unique.set(state.user.id, { id: state.user.id, name: state.user.name })
    }
    this.broadcastRoom(roomId, {
      type: 'presence',
      roomId,
      users: [...unique.values()],
      ts: new Date().toISOString(),
    })
  }

  close(): void {
    this.unsubscribeLease?.()
    for (const socket of this.clients.keys()) socket.close(1001, 'Server shutting down')
    for (const socket of this.desktopStreams.keys()) socket.close(1001, 'Server shutting down')
    this.socketServer.close()
    this.desktopSocketServer.close()
  }
}
