import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import * as samlify from 'samlify'
import { createId } from '@openstaff/shared'
import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import { createAuditWriter } from '../audit.js'
import { invitationRoutes, memberRoutes, publicInvitationRoutes } from '../api/members.js'
import { securityRoutes } from '../api/security.js'
import type { AppEnv } from '../api/context.js'
import { readConfig, type Config } from '../config.js'
import { createDatabase } from '../db/index.js'
import * as schema from '../db/schema.js'
import { account, auditLog, invitations, sessions, ssoProvider, users, workspace } from '../db/schema.js'
import type { EmailMessage } from '../email/index.js'
import { consoleMailer } from '../email/console.js'
import { signedIn, TEST_PASSWORD } from '../test/auth.js'
import { requireAuth } from './session.js'
import { authHandler, createAuth, ssoMutationGuard } from './better-auth.js'
import { hashPassword } from './password.js'
import { RealtimeHub } from '../realtime/hub.js'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })

const samlPrivateKey = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCeF2EwLfIZcCM3
Gd1+MMmaz4Smb8lB1HSLghY7y/PcQxWTchNybBH4rkHVr0dpbNE9NDEZvlpdtxZz
bTWcqcxz0PmocU7HQ2cVSWQBd0jcrQqMPa7ovoVesPthB7Ni9d3DLLVM8PYsQG7Q
Qq68EDkNadiNCnvRSHYfBOoCcg2tkq4p8oxGkXQ9clQQWFr0BaZ2PsXjZN+lV3nP
8nxzqYSljqzRXGaShQ4aldO1D3ae2F708X9Xg1F8FShKNV3d6vNom5q/i+V0cCUG
0aEkQ8ERoUXpTlYBSlmJLwunL8+dZ/dRxy/JO4j9vWBM7ruYsK/OWyOItdHjjx/V
IuPAMMqTAgMBAAECggEAOJmHPrAcbtYSjY4xmhXOgCIOzGXWSL7PMQlUe3kkKDZO
WbksVDlz37RHtsDn0MtYSFDQyXY4tTexDodJe/rgy5BEafWTLk0n8VuSteGmkPdV
AOuunP5lEodLoKwYofQDvvZZPKBCiopRAjf1hjhKrM457RkVRlLqk2V3gIOj+QGs
UaRKiU0ocHWCfVMQBIsXy7bBUYA8bWwhIxJ33IsS8ApixwBrO4TG0tI79yy5P5SD
KijElGSCUHtaSDCTD0m3cCFIgsdg2iMvx9O7eOgWKAakaX39dVTFQ6XRSf0otarO
pURxEN1OYT/WaE5NWEwf/lB1Hm3lnfvAJcRizgU2pQKBgQDK9sCbkvFJ1EIFp3BP
9X0K6Y0u+xXN0oDYvOmiFE8EoKkVCqeRDge01mmtxWpnXjWMwqGjv+Z0Ruwn4bP2
tApNRJClS+ZB3PitGVisjhxGHmSFULJy/jszFd+hfzzkg0mLiGIVpl5qa92awO7T
oqVkRLQyryfJWwhk1xV/dcTwdQKBgQDHZuH2wCS1w8j9QN00fGm86SY2TtiCwdE6
UmmzjA9suPjfsynWHONnAdBTxFVN4DSjWaPKRoITjwi7ENA6pQAO20nsEAHssp4A
AQePBMJo2o9QMEcZ8AuG35i+yTO/LCuQmoRJSzOVPOqooHn6L6WSnX+8BEOYc00d
o9q0uXJt5wKBgFE2AIV/e1qOOsimYbMsyBbIsrw8rVHIy9Nta5J1y9RPMLiBpeDN
m1nJfUmRt2ya7pRfAGxUCbM2+aFPl0G8cm7OY44wW3a5Iyun+6o3xqpr2M7bJjwK
68caFnw5PDU3LwNM0+pTwm2UsXwNfMJjzwfa0buCCEpySV6IDUsN5XpNAoGAJX8v
VttjC9s5XIZqEoiiyad+TBAfntcbpUACKIVaETPneQmUAHOGP8STjG0LLY3P2Dfv
GQaRR2RKXAMZZS3KCQErsXyBICWmmJGY/kgC1vzink210SbWxBIgAyCK3pRLzPGB
ltbRaGsAJZ2n0mhLVnrPnmee3ngwNDav1fRZlFkCgYBMnVoTSEwjmps+0TnM4FmJ
o7UbFHuuf1zkVJIh345oWY3KAbMX7ZCtMPTndwGB9NSj/HBu5WhHMFajgawxts9j
BO65gx8S/5T4oe++P3eZIcLnLNhoIMmVnWGMQvn9oATjqhY2orRUWY+zZIKBM9NW
sOw994n+M6Vz/XK3wyHiKQ==
-----END PRIVATE KEY-----`
const samlCertificate = `-----BEGIN CERTIFICATE-----
MIIDGzCCAgOgAwIBAgIUey0BLyUg1VHmM4fnCLENIEfkfwgwDQYJKoZIhvcNAQEL
BQAwHTEbMBkGA1UEAwwST3BlblN0YWZmIFRlc3QgSWRQMB4XDTI2MDkxNTA1Mjgz
NloXDTM2MDkxMjA1MjgzNlowHTEbMBkGA1UEAwwST3BlblN0YWZmIFRlc3QgSWRQ
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnhdhMC3yGXAjNxndfjDJ
ms+Epm/JQdR0i4IWO8vz3EMVk3ITcmwR+K5B1a9HaWzRPTQxGb5aXbcWc201nKnM
c9D5qHFOx0NnFUlkAXdI3K0KjD2u6L6FXrD7YQezYvXdwyy1TPD2LEBu0EKuvBA5
DWnYjQp70Uh2HwTqAnINrZKuKfKMRpF0PXJUEFha9AWmdj7F42TfpVd5z/J8c6mE
pY6s0VxmkoUOGpXTtQ92nthe9PF/V4NRfBUoSjVd3erzaJuav4vldHAlBtGhJEPB
EaFF6U5WAUpZiS8Lpy/PnWf3UccvyTuI/b1gTO67mLCvzlsjiLXR448f1SLjwDDK
kwIDAQABo1MwUTAdBgNVHQ4EFgQUVkHXlcS38GHWVSFnWUk82QqHa/8wHwYDVR0j
BBgwFoAUVkHXlcS38GHWVSFnWUk82QqHa/8wDwYDVR0TAQH/BAUwAwEB/zANBgkq
hkiG9w0BAQsFAAOCAQEAMf4r5/Wa4snIWb62wKB9n45NMQpGI6bbk+KuMojkvcM3
F1kJ/2USf3lkGQSuNw8SldgVhatLwsqMaelaPCMhdZuLYMM0XdKgaQQWr5UN/pDZ
nbLjEkOkZIJtBR9/lwb7Jlp7xGwm2I8vKT/gBAonweGWfQhm7xOL8OYRdx27xLiP
I6QY56vnLUrobqqxgVaQnh9PyZIE8dFehzPkL/EPffwYMQwFH38HECNHX7WhJsLL
5bARVbRLLdin+3c1UdlPzhrJhhuG6E6YfPYCncJoHIKz8BddKfnMXaA8IP4AXBPX
rBiIH/z69kulGQYEdW7YarVFKyEtqCdbZebCKoAV7A==
-----END CERTIFICATE-----`

async function harness(overrides: Partial<Config> = {}, transport?: (message: EmailMessage) => Promise<void>) {
  const directory = await fs.mkdtemp(path.resolve('data-test-auth-'))
  directories.push(directory)
  const database = await createDatabase(directory)
  const config = readConfig({ dataDir: directory, authSecret: 'auth-test-secret-at-least-thirty-two-characters', authSignup: 'open', email: { provider: 'console' }, ...overrides })
  const sent: EmailMessage[] = [], sendEmail = transport ?? (async (message: EmailMessage) => { sent.push(message) })
  const audit = createAuditWriter(database.db), auth = createAuth(config, database.db, { sendEmail, audit })
  const app = new Hono<AppEnv>()
  const guard = ssoMutationGuard(auth, config)
  for (const route of ['/api/auth/sso/register', '/api/auth/sso/update-provider', '/api/auth/sso/delete-provider', '/api/auth/sso/request-domain-verification', '/api/auth/sso/verify-domain']) app.use(route, guard)
  app.on(['GET', 'POST'], '/api/auth/*', authHandler(auth))
  app.route('/api/invitations', publicInvitationRoutes({ db: database.db }))
  app.use('/api/*', requireAuth(auth, database.db))
  app.route('/api/invitations', invitationRoutes({ db: database.db, config, sendEmail, audit }))
  app.route('/api/members', memberRoutes({ db: database.db, audit }))
  app.route('/api/security', securityRoutes({ db: database.db, config, audit }))
  app.get('/api/protected', (context) => context.json({ user: context.get('user') }))
  return { app, auth, database, config, sent, close: () => database.close() }
}

function oidcProvider(providerId: string, domain = 'example.test') {
  const issuer = `https://${providerId}.idp.example.test`
  return { providerId, issuer, domain, oidcConfig: { clientId: `${providerId}-client`, clientSecret: 'test-client-secret', skipDiscovery: true, authorizationEndpoint: `${issuer}/authorize`, tokenEndpoint: `${issuer}/token`, jwksEndpoint: `${issuer}/jwks` } }
}

function jsonPost(body: unknown, cookie?: string): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }
}

function responseCookies(response: Response, fallback = ''): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const values = headers.getSetCookie?.() ?? (response.headers.get('set-cookie')?.split(/,(?=\s*openstaff\.)/) ?? [])
  const cookies = values.map((value) => value.trim().split(';')[0]).filter(Boolean).join('; ')
  return cookies || fallback
}

async function signup(app: Hono<AppEnv>, email: string, extra: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return app.request('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ name: email.split('@')[0], email, password: TEST_PASSWORD, ...extra }) })
}

describe('sign-up policy', () => {
  it('allows open sign-up and assigns exactly one owner', async () => {
    const h = await harness()
    try {
      expect((await signup(h.app, 'owner@example.test')).status).toBe(200)
      expect((await signup(h.app, 'member@example.test')).status).toBe(200)
      const rows = await h.database.db.select({ email: users.email, role: users.role }).from(users).orderBy(users.email)
      expect(rows).toEqual([{ email: 'member@example.test', role: 'member' }, { email: 'owner@example.test', role: 'owner' }])
    } finally { h.close() }
  })

  it('honours a code from the body and closes code mode when no code is configured', async () => {
    const coded = await harness({ authSignup: 'code', signupCode: 'join-us' })
    try {
      const rejected = await signup(coded.app, 'owner@example.test')
      expect(rejected.status).toBe(403); expect(await rejected.json()).toMatchObject({ code: 'invalid_signup_code' })
      expect((await signup(coded.app, 'owner@example.test', { signupCode: 'join-us' })).status).toBe(200)
    } finally { coded.close() }
    const closed = await harness({ authSignup: 'code', signupCode: '' })
    try {
      expect((await signup(closed.app, 'owner@example.test')).status).toBe(200)
      const rejected = await signup(closed.app, 'member@example.test')
      expect(rejected.status).toBe(403); expect(await rejected.json()).toMatchObject({ code: 'signup_closed' })
    } finally { closed.close() }
  })

  it('requires an invitation and applies the hosted member limit', async () => {
    const invited = await harness({ authSignup: 'invite' })
    try {
      expect((await signup(invited.app, 'owner@example.test')).status).toBe(200)
      const rejected = await signup(invited.app, 'member@example.test')
      expect(rejected.status).toBe(403); expect(await rejected.json()).toMatchObject({ code: 'invitation_required' })
    } finally { invited.close() }
    const limited = await harness({ plan: 'starter' })
    try {
      const now = new Date()
      await limited.database.db.insert(users).values([1, 2, 3].map((value) => ({ id: createId('user'), email: `member-${value}@example.test`, name: `Member ${value}`, role: value === 1 ? 'owner' as const : 'member' as const, createdAt: now, updatedAt: now })))
      const rejected = await signup(limited.app, 'four@example.test', {}, { 'x-forwarded-for': '192.0.2.44' })
      expect(rejected.status).toBe(402); expect(await rejected.json()).toMatchObject({ code: 'plan_limit', limit: 'members' })
    } finally { limited.close() }
  })
})

it('runs an invitation round trip with only a SHA-256 token hash stored', async () => {
  const h = await harness({ authSignup: 'invite', publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
  try {
    const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
    const created = await h.app.request('http://app.example.test/api/invitations', { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'invitee@example.test', role: 'admin' }) })
    expect(created.status).toBe(201)
    const token = h.sent[0]!.text.match(/\/invite\/(\S+)/)?.[1]
    expect(token).toBeTruthy()
    const stored = (await h.database.db.select().from(invitations))[0]!
    expect(stored.tokenHash).not.toContain(token!)
    const details = await h.app.request(`http://app.example.test/api/invitations/${token}`)
    expect(await details.json()).toMatchObject({ invitation: { email: 'invitee@example.test', workspaceName: 'OpenStaff' } })
    // Signing up with the invited email already applies the role and settles the invitation.
    const invitee = await signedIn(h, { email: 'invitee@example.test' })
    expect((await h.database.db.select({ role: users.role }).from(users).where(eq(users.id, invitee.user.id)).limit(1))[0]?.role).toBe('admin')
    expect((await h.database.db.select().from(invitations).where(and(eq(invitations.id, stored.id), isNull(invitations.acceptedAt))))).toHaveLength(0)
    // The invite page still posts an accept afterwards and revisits the link, so both report the settled state instead of "expired".
    const accepted = await h.app.request(`http://app.example.test/api/invitations/${token}/accept`, { method: 'POST', headers: { cookie: invitee.cookie } })
    expect(accepted.status).toBe(200); expect(await accepted.json()).toEqual({ ok: true, status: 'accepted' })
    const revisited = await h.app.request(`http://app.example.test/api/invitations/${token}`)
    expect(revisited.status).toBe(200); expect(await revisited.json()).toMatchObject({ invitation: { email: 'invitee@example.test', status: 'accepted' } })
    expect((await h.app.request('http://app.example.test/api/invitations/not-a-token')).status).toBe(404)
  } finally { h.close() }
})

it('reports expired and revoked invitations by status and refuses to accept them', async () => {
  const h = await harness({ publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
  try {
    const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
    const member = await signedIn(h, { email: 'member@example.test', role: 'member' })
    const seed = async (token: string, row: { expiresAt?: string; revokedAt?: string }) => h.database.db.insert(invitations).values({ id: createId('invitation'), email: member.user.email, role: 'admin', tokenHash: createHash('sha256').update(token).digest('hex'), invitedBy: owner.user.id, expiresAt: row.expiresAt ?? new Date(Date.now() + 60_000).toISOString(), revokedAt: row.revokedAt ?? null, createdAt: new Date().toISOString() })
    await seed('expired-token', { expiresAt: new Date(Date.now() - 1000).toISOString() })
    await seed('revoked-token', { revokedAt: new Date().toISOString() })
    expect(await (await h.app.request('http://app.example.test/api/invitations/expired-token')).json()).toMatchObject({ invitation: { status: 'expired' } })
    expect(await (await h.app.request('http://app.example.test/api/invitations/revoked-token')).json()).toMatchObject({ invitation: { status: 'revoked' } })
    for (const token of ['expired-token', 'revoked-token']) {
      expect((await h.app.request(`http://app.example.test/api/invitations/${token}/accept`, { method: 'POST', headers: { cookie: member.cookie } })).status).toBe(410)
    }
    expect((await h.database.db.select({ role: users.role }).from(users).where(eq(users.id, member.user.id)).limit(1))[0]?.role).toBe('member')
  } finally { h.close() }
})

it('still accepts an invitation by token for an account that already exists', async () => {
  const h = await harness({ publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
  try {
    const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
    const member = await signedIn(h, { email: 'member@example.test', role: 'member' })
    // The create route refuses an email that already has an account, so the row is seeded directly.
    const token = 'already-registered-token'
    await h.database.db.insert(invitations).values({ id: createId('invitation'), email: member.user.email, role: 'admin', tokenHash: createHash('sha256').update(token).digest('hex'), invitedBy: owner.user.id, expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString() })
    expect((await h.app.request(`http://app.example.test/api/invitations/${token}/accept`, { method: 'POST', headers: { cookie: member.cookie } })).status).toBe(200)
    expect((await h.database.db.select({ role: users.role }).from(users).where(eq(users.id, member.user.id)).limit(1))[0]?.role).toBe('admin')
  } finally { h.close() }
})

interface InviteBody { invitation: { id: string; status: string }; inviteUrl: string; delivery: string }
const inviteToken = (url: string) => url.slice(url.lastIndexOf('/') + 1)

it('returns the invite link and lets a pending invitation bypass the signup code and carry its role', async () => {
  const h = await harness({ authSignup: 'code', signupCode: 'join-us', publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
  try {
    const ownerResponse = await signup(h.app, 'owner@example.test', { signupCode: 'join-us' })
    expect(ownerResponse.status).toBe(200)
    const created = await h.app.request('http://app.example.test/api/invitations', jsonPost({ email: 'Invitee@Example.test', role: 'admin' }, responseCookies(ownerResponse)))
    expect(created.status).toBe(201)
    const body = await created.json() as InviteBody
    expect(body.delivery).toBe('link')
    expect(body.inviteUrl).toMatch(/^http:\/\/app\.example\.test\/invite\/[\w-]+$/)
    // The code is never supplied: the invitation alone admits the email, in code mode.
    expect((await signup(h.app, 'invitee@example.test')).status).toBe(200)
    expect((await h.database.db.select({ role: users.role }).from(users).where(eq(users.email, 'invitee@example.test')).limit(1))[0]?.role).toBe('admin')
    expect((await h.database.db.select({ acceptedAt: invitations.acceptedAt }).from(invitations).where(eq(invitations.id, body.invitation.id)).limit(1))[0]?.acceptedAt).toBeTruthy()
    const events = await h.database.db.select({ event: auditLog.event }).from(auditLog)
    expect(events.map((row) => row.event)).toContain('member.invite_accepted')
  } finally { h.close() }
})

it('consumes a pending invitation on magic-link sign-up', async () => {
  const h = await harness({ authSignup: 'invite', publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
  try {
    const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
    const created = await h.app.request('http://app.example.test/api/invitations', jsonPost({ email: 'invitee@example.test', role: 'admin' }, owner.cookie))
    const { invitation } = await created.json() as InviteBody
    const requested = await h.app.request('http://app.example.test/api/auth/sign-in/magic-link', jsonPost({ email: 'invitee@example.test', callbackURL: '/' }))
    expect(requested.status).toBe(200)
    const verified = await h.app.request(h.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0])
    expect(verified.status).toBe(302)
    expect((await h.database.db.select({ role: users.role }).from(users).where(eq(users.email, 'invitee@example.test')).limit(1))[0]?.role).toBe('admin')
    expect((await h.database.db.select({ acceptedAt: invitations.acceptedAt }).from(invitations).where(eq(invitations.id, invitation.id)).limit(1))[0]?.acceptedAt).toBeTruthy()
  } finally { h.close() }
})

it('lists expired invitations and resends them with a rotated token', async () => {
  const h = await harness({ authSignup: 'invite', publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
  try {
    const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
    const created = await h.app.request('http://app.example.test/api/invitations', jsonPost({ email: 'invitee@example.test', role: 'member' }, owner.cookie))
    const first = await created.json() as InviteBody
    await h.database.db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(invitations.id, first.invitation.id))
    const listed = await h.app.request('http://app.example.test/api/invitations', { headers: { cookie: owner.cookie } })
    expect(await listed.json()).toMatchObject({ invitations: [{ id: first.invitation.id, status: 'expired' }] })
    const resent = await h.app.request(`http://app.example.test/api/invitations/${first.invitation.id}/resend`, jsonPost({}, owner.cookie))
    expect(resent.status).toBe(200)
    const second = await resent.json() as InviteBody
    expect(second.invitation).toMatchObject({ id: first.invitation.id, status: 'pending' })
    expect(second.inviteUrl).not.toBe(first.inviteUrl)
    expect((await h.app.request(`http://app.example.test/api/invitations/${inviteToken(first.inviteUrl)}`)).status).toBe(404)
    expect((await h.app.request(`http://app.example.test/api/invitations/${inviteToken(second.inviteUrl)}`)).status).toBe(200)
    expect((await h.app.request('http://app.example.test/api/invitations/invitation_missing/resend', jsonPost({}, owner.cookie))).status).toBe(404)
    const events = await h.database.db.select({ event: auditLog.event }).from(auditLog)
    expect(events.map((row) => row.event)).toContain('member.invite_resent')
  } finally { h.close() }
})

it('refuses to ban or revoke the sessions of your own account', async () => {
  const h = await harness()
  try {
    await signedIn(h, { email: 'owner@example.test', role: 'owner' })
    const admin = await signedIn(h, { email: 'admin@example.test', role: 'admin' })
    for (const action of ['ban', 'revoke-sessions']) {
      const response = await h.app.request(`/api/members/${admin.user.id}/${action}`, jsonPost({}, admin.cookie))
      expect(response.status, action).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'You cannot do this to your own account.' })
    }
    expect((await h.database.db.select({ banned: users.banned }).from(users).where(eq(users.id, admin.user.id)).limit(1))[0]?.banned).toBeFalsy()
  } finally { h.close() }
})

it('lets workspace administrators change roles and remove non-owner members', async () => {
  const h = await harness()
  try {
    const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
    const member = await signedIn(h, { email: 'member@example.test', role: 'member' })
    const changed = await h.app.request(`/api/members/${member.user.id}`, { method: 'PATCH', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'admin' }) })
    expect(changed.status).toBe(200); expect(await changed.json()).toMatchObject({ member: { role: 'admin' } })
    const removed = await h.app.request(`/api/members/${member.user.id}`, { method: 'DELETE', headers: { cookie: owner.cookie } })
    expect(removed.status).toBe(200)
    expect(await h.database.db.select().from(users).where(eq(users.id, member.user.id))).toHaveLength(0)
    const events = await h.database.db.select({ event: auditLog.event }).from(auditLog)
    expect(events.map((row) => row.event)).toEqual(expect.arrayContaining(['member.role_changed', 'member.removed']))
  } finally { h.close() }
})

it('sends and consumes a magic link and audits successful and failed sign-in', async () => {
  const output: string[] = [], log = vi.spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)) })
  const h = await harness({ publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] }, consoleMailer)
  try {
    await signedIn(h, { email: 'magic@example.test' })
    const magic = await h.app.request('http://app.example.test/api/auth/sign-in/magic-link', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://app.example.test' }, body: JSON.stringify({ email: 'magic@example.test', callbackURL: '/' }) })
    expect(magic.status).toBe(200); expect(output[0]).toBe('[email] to=magic@example.test subject=Your OpenStaff sign-in link')
    const url = new URL(output.find((line) => line.startsWith('http'))!)
    const verified = await h.app.request(url.toString())
    expect(verified.status).toBe(302); expect(verified.headers.get('set-cookie')).toContain('openstaff.session_token')
    expect((await h.app.request('http://app.example.test/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://app.example.test' }, body: JSON.stringify({ email: 'magic@example.test', password: 'wrong-password' }) })).status).toBe(401)
    const events = await h.database.db.select({ event: auditLog.event }).from(auditLog)
    expect(events.map((row) => row.event)).toEqual(expect.arrayContaining(['auth.sign_in', 'auth.sign_in_failed']))
  } finally { log.mockRestore(); h.close() }
})

it('signs in a legacy password after the migration copies it to account', async () => {
  const directory = await fs.mkdtemp(path.resolve('data-test-legacy-auth-'))
  directories.push(directory)
  const client = createClient({ url: `file:${path.join(directory, 'openstaff.db')}` })
  const userId = createId('user'), createdAt = new Date().toISOString(), password = 'legacy-password'
  await client.executeMultiple(`CREATE TABLE users (id text PRIMARY KEY NOT NULL, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, avatar text, role text NOT NULL, created_at text NOT NULL); CREATE TABLE sessions (id text PRIMARY KEY NOT NULL, user_id text NOT NULL, expires_at text NOT NULL); INSERT INTO users (id,email,name,password_hash,avatar,role,created_at) VALUES ('${userId}','legacy@example.test','Legacy','${await hashPassword(password)}',NULL,'owner','${createdAt}');`)
  const migration = (await fs.readFile(path.resolve('apps/server/drizzle/0015_better_auth.sql'), 'utf8')).replaceAll(/\n?\s*\/\*[^]*?\*\/\s*/g, '\n')
  await client.executeMultiple(migration)
  const db = drizzle(client, { schema })
  const config = readConfig({ dataDir: directory, authSecret: 'legacy-test-secret-at-least-thirty-two-characters', authSignup: 'open', email: { provider: 'console' } })
  const auth = createAuth(config, db, { sendEmail: async () => undefined, audit: createAuditWriter(db) })
  const app = new Hono()
  app.on(['GET', 'POST'], '/api/auth/*', authHandler(auth))
  const response = await app.request('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'legacy@example.test', password }) })
  expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toContain('openstaff.session_token')
  expect((await db.select({ password: account.password }).from(account).where(eq(account.userId, userId)).limit(1))[0]?.password).toMatch(/^scrypt:/)
  client.close()
})

it('reserves Better Auth admin endpoints for the owner and disables the dangerous ones', async () => {
  const h = await harness()
  try {
    const owner = await signedIn(h, { email: 'owner@example.test' })
    const admin = await signedIn(h, { email: 'admin@example.test', role: 'admin' })
    const list = (cookie: string) => h.app.request('/api/auth/admin/list-users', { headers: { cookie } })
    expect((await list(owner.cookie)).status).toBe(200)
    expect((await list(admin.cookie)).status).toBe(403)
    for (const name of ['impersonate-user', 'set-role', 'create-user', 'update-user', 'set-user-password', 'stop-impersonating']) {
      const response = await h.app.request(`/api/auth/admin/${name}`, { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ userId: admin.user.id, role: 'owner' }) })
      expect(response.status, name).toBe(404)
    }
    expect((await h.database.db.select({ role: users.role }).from(users).where(eq(users.id, admin.user.id)))[0]?.role).toBe('admin')
  } finally { h.close() }
})

describe('single sign-on controls', () => {
  it('guards provider registration by role and plan', async () => {
    const selfHosted = await harness({ publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
    try {
      const owner = await signedIn(selfHosted, { email: 'owner@example.test', role: 'owner' })
      const member = await signedIn(selfHosted, { email: 'member@example.test', role: 'member' })
      expect((await selfHosted.app.request('http://app.example.test/api/auth/sso/register', jsonPost(oidcProvider('member-provider'), member.cookie))).status).toBe(403)
      const created = await selfHosted.app.request('http://app.example.test/api/auth/sso/register', jsonPost(oidcProvider('owner-provider'), owner.cookie))
      expect(created.status).toBe(200)
      expect((await selfHosted.database.db.select({ providerId: ssoProvider.providerId }).from(ssoProvider))[0]?.providerId).toBe('owner-provider')
    } finally { selfHosted.close() }

    const starter = await harness({ plan: 'starter', publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
    try {
      const owner = await signedIn(starter, { email: 'owner@example.test', role: 'owner' })
      const rejected = await starter.app.request('http://app.example.test/api/auth/sso/register', jsonPost(oidcProvider('starter-provider'), owner.cookie))
      expect(rejected.status).toBe(402); expect(await rejected.json()).toMatchObject({ code: 'plan_limit', limit: 'sso' })
    } finally { starter.close() }

    const business = await harness({ plan: 'business', publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
    try {
      const owner = await signedIn(business, { email: 'owner@example.test', role: 'owner' })
      expect((await business.app.request('http://app.example.test/api/auth/sso/register', jsonPost(oidcProvider('business-provider'), owner.cookie))).status).toBe(200)
    } finally { business.close() }
  })

  it('enforces SSO-only for matching domains and exempts the owner', async () => {
    const h = await harness({ publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
    try {
      await signedIn(h, { email: 'owner@example.test', role: 'owner' })
      await signedIn(h, { email: 'member@example.test', role: 'member' })
      await signedIn(h, { email: 'outside@elsewhere.test', role: 'member' })
      await h.database.db.insert(ssoProvider).values({ id: createId('ssoProvider'), providerId: 'company-sso', issuer: 'https://idp.example.test', domain: 'example.test', userId: (await h.database.db.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).limit(1))[0]!.id })
      const row = (await h.database.db.select({ settings: workspace.settings }).from(workspace).limit(1))[0]!
      await h.database.db.update(workspace).set({ settings: { ...row.settings, auth: { ssoOnly: true, requireTwoFactor: false } } })
      const login = (email: string) => h.app.request('http://app.example.test/api/auth/sign-in/email', jsonPost({ email, password: TEST_PASSWORD }))
      const blocked = await login('member@example.test')
      expect(blocked.status).toBe(403); expect(await blocked.json()).toMatchObject({ code: 'sso_required' })
      expect((await login('owner@example.test')).status).toBe(200)
      expect((await login('outside@elsewhere.test')).status).toBe(200)
    } finally { h.close() }
  })

  it('never lets a registered SSO domain waive the policy for password sign-up, and SSO-only refuses it outright', async () => {
    const h = await harness({ authSignup: 'invite', publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
    try {
      const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
      await h.database.db.insert(ssoProvider).values({ id: createId('ssoProvider'), providerId: 'company-sso', issuer: 'https://idp.example.test', domain: 'example.test', userId: owner.user.id })
      const rejected = await signup(h.app, 'newbie@example.test')
      expect(rejected.status).toBe(403); expect(await rejected.json()).toMatchObject({ code: 'invitation_required' })
      const row = (await h.database.db.select({ settings: workspace.settings }).from(workspace).limit(1))[0]!
      await h.database.db.update(workspace).set({ settings: { ...row.settings, auth: { ssoOnly: true, requireTwoFactor: false } } })
      const ssoOnly = await signup(h.app, 'another@example.test')
      expect(ssoOnly.status).toBe(403); expect(await ssoOnly.json()).toMatchObject({ code: 'sso_required' })
      expect(await h.database.db.select().from(users).where(eq(users.email, 'newbie@example.test'))).toHaveLength(0)
    } finally { h.close() }
  })

  it('completes OIDC sign-in and applies invite policy to provisioned users', async () => {
    const issuer = 'https://oidc.example.test', clientId = 'openstaff-test-client', keyId = 'test-key'
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey), nonces = new Map<string, string | undefined>()
    let profileEmail = 'intruder@elsewhere.test'
    const idp = new Hono()
    idp.get('/.well-known/openid-configuration', (context) => context.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, id_token_signing_alg_values_supported: ['RS256'], response_types_supported: ['code'], subject_types_supported: ['public'], token_endpoint_auth_methods_supported: ['client_secret_basic'] }))
    idp.get('/jwks', (context) => context.json({ keys: [{ ...publicJwk, kid: keyId, use: 'sig', alg: 'RS256' }] }))
    idp.get('/authorize', (context) => {
      const code = `code-${nonces.size + 1}`
      nonces.set(code, context.req.query('nonce'))
      const callback = new URL(context.req.query('redirect_uri')!)
      callback.searchParams.set('code', code); callback.searchParams.set('state', context.req.query('state')!)
      return context.redirect(callback.toString())
    })
    idp.post('/token', async (context) => {
      const body = await context.req.parseBody(), code = String(body.code)
      const now = Math.floor(Date.now() / 1000)
      const token = await new SignJWT({ email: profileEmail, email_verified: true, name: 'OIDC Person', ...(nonces.get(code) ? { nonce: nonces.get(code) } : {}) }).setProtectedHeader({ alg: 'RS256', kid: keyId }).setIssuer(issuer).setAudience(clientId).setSubject('oidc-subject').setIssuedAt(now).setExpirationTime(now + 300).sign(privateKey)
      return context.json({ access_token: 'access-token', token_type: 'Bearer', expires_in: 300, id_token: token })
    })
    const nativeFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      return url.origin === new URL(issuer).origin ? idp.request(url.toString(), input instanceof Request ? input : init) : nativeFetch(input, init)
    })
    const h = await harness({ authSignup: 'invite', publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test', issuer] })
    try {
      const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
      const registration = await h.app.request('http://app.example.test/api/auth/sso/register', jsonPost({ providerId: 'oidc-company', issuer, domain: 'example.test', oidcConfig: { clientId, clientSecret: 'client-secret' } }, owner.cookie))
      expect(registration.status, await registration.clone().text()).toBe(200)
      const begin = async () => {
        const response = await h.app.request('http://app.example.test/api/auth/sign-in/sso', jsonPost({ email: 'employee@example.test', callbackURL: '/' }))
        expect(response.status).toBe(200)
        const data = await response.clone().json() as { url: string }
        const authorization = await idp.request(data.url)
        return h.app.request(authorization.headers.get('location')!, { headers: { cookie: responseCookies(response) } })
      }
      const rejected = await begin()
      expect(rejected.status).toBe(302)
      expect(await h.database.db.select().from(users).where(eq(users.email, 'intruder@elsewhere.test'))).toHaveLength(0)
      profileEmail = 'employee@example.test'
      const callback = await begin()
      expect(callback.status).toBe(302); expect(responseCookies(callback)).toContain('openstaff.session_token=')
      const created = (await h.database.db.select().from(users).where(eq(users.email, profileEmail)).limit(1))[0]
      expect(created?.name).toBe('OIDC Person')
      expect((await h.database.db.select().from(account).where(and(eq(account.userId, created!.id), eq(account.providerId, 'oidc-company'))))).toHaveLength(1)
      const signInAudit = await h.database.db.select().from(auditLog).where(eq(auditLog.event, 'auth.sign_in'))
      expect(signInAudit.some((row) => row.metadata.method === 'sso')).toBe(true)
    } finally { h.close() }
  })

  it('completes a signed SAML round trip with request correlation', async () => {
    const providerId = 'saml-company', idpIssuer = 'https://saml.example.test/metadata', idpLogin = 'https://saml.example.test/login'
    const idp = samlify.IdentityProvider({
      entityID: idpIssuer,
      privateKey: samlPrivateKey,
      signingCert: samlCertificate,
      singleSignOnService: [{ Binding: samlify.Constants.namespace.binding.redirect, Location: idpLogin }],
      nameIDFormat: [samlify.Constants.namespace.format.emailAddress],
      loginResponseTemplate: {
        context: samlify.SamlLib.defaultLoginResponseTemplate.context,
        attributes: [
          { name: 'email', nameFormat: samlify.Constants.namespace.format.unspecified, valueXsiType: 'xs:string', valueTag: 'email' },
          { name: 'displayName', nameFormat: samlify.Constants.namespace.format.unspecified, valueXsiType: 'xs:string', valueTag: 'displayName' },
        ],
      },
    })
    const idpRuntime = idp as unknown as { entitySetting: { loginResponseTemplate: { context: string }; tagPrefixedDefaults?: { loginResponseTemplate: { context: string } } } }
    idpRuntime.entitySetting.tagPrefixedDefaults = { loginResponseTemplate: { context: idpRuntime.entitySetting.loginResponseTemplate.context.replaceAll('{attrEmail}', 'saml-user@example.test').replaceAll('{attrDisplayName}', 'SAML Person') } }
    const h = await harness({ authSignup: 'invite', publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
    try {
      const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
      const entityId = `http://app.example.test/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`
      const registration = await h.app.request('http://app.example.test/api/auth/sso/register', jsonPost({ providerId, issuer: entityId, domain: 'example.test', samlConfig: { entryPoint: idpLogin, idpMetadata: { metadata: idp.getMetadata() }, wantAssertionsSigned: true, mapping: { email: 'email', name: 'displayName' } } }, owner.cookie))
      expect(registration.status, await registration.clone().text()).toBe(200)
      const metadata = await h.app.request(entityId)
      expect(metadata.status).toBe(200)
      const sp = samlify.ServiceProvider({ metadata: await metadata.text() })
      const begin = await h.app.request('http://app.example.test/api/auth/sign-in/sso', jsonPost({ email: 'saml-user@example.test', callbackURL: '/' }))
      expect(begin.status).toBe(200)
      const loginUrl = new URL((await begin.clone().json() as { url: string }).url)
      const requestInfo = await idp.parseLoginRequest(sp, 'redirect', { query: Object.fromEntries(loginUrl.searchParams), octetString: loginUrl.search.slice(1) })
      const loginResponse = await idp.createLoginResponse(sp, { extract: requestInfo.extract }, 'post', { email: 'saml-user@example.test', displayName: 'SAML Person' }, { relayState: loginUrl.searchParams.get('RelayState') ?? undefined })
      expect(Buffer.from(loginResponse.context, 'base64').toString()).toContain('saml-user@example.test')
      const parsedResponse = await sp.parseLoginResponse(idp, 'post', { body: { SAMLResponse: loginResponse.context } })
      expect(parsedResponse.extract, JSON.stringify(parsedResponse.extract)).toMatchObject({ nameID: 'saml-user@example.test', attributes: { email: 'saml-user@example.test', displayName: 'SAML Person' } })
      const body = new URLSearchParams({ SAMLResponse: loginResponse.context, ...(loginUrl.searchParams.get('RelayState') ? { RelayState: loginUrl.searchParams.get('RelayState')! } : {}) })
      const callback = await h.app.request(`http://app.example.test/api/auth/sso/saml2/sp/acs/${providerId}`, { method: 'POST', headers: { cookie: responseCookies(begin), 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() })
      expect(callback.status, await callback.clone().text()).toBe(302)
      expect(responseCookies(callback), callback.headers.get('location') ?? '').toContain('openstaff.session_token=')
      const created = (await h.database.db.select().from(users).where(eq(users.email, 'saml-user@example.test')).limit(1))[0]
      expect(created?.name).toBe('SAML Person')
      expect((await h.database.db.select().from(account).where(and(eq(account.userId, created!.id), eq(account.providerId, providerId))))).toHaveLength(1)
      const signInAudit = await h.database.db.select().from(auditLog).where(eq(auditLog.event, 'auth.sign_in'))
      expect(signInAudit.some((row) => row.metadata.method === 'sso')).toBe(true)
    } finally { h.close() }
  })
})

describe('workspace security and two-factor', () => {
  it('allows administrators to read settings but only owners to change them and audits the diff', async () => {
    const h = await harness()
    try {
      const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
      const adminUser = await signedIn(h, { email: 'admin@example.test', role: 'admin' })
      await h.database.db.insert(ssoProvider).values({ id: createId('ssoProvider'), providerId: 'owner-made', issuer: 'https://idp.example.test', domain: 'example.test', userId: owner.user.id, oidcConfig: JSON.stringify({ clientId: 'client-1234', clientSecret: 'top-secret-value', discoveryEndpoint: 'https://idp.example.test/.well-known/openid-configuration' }) })
      const listed = await h.app.request('/api/security', { headers: { cookie: adminUser.cookie } })
      expect(listed.status).toBe(200)
      const listedText = await listed.clone().text()
      expect(await listed.json()).toMatchObject({ providers: [{ providerId: 'owner-made', type: 'oidc', oidcConfig: { clientIdLastFour: '1234' } }] })
      expect(listedText).not.toContain('top-secret-value')
      expect((await h.app.request('/api/security', { ...jsonPost({ ssoOnly: true }, adminUser.cookie), method: 'PATCH' })).status).toBe(403)
      const changed = await h.app.request('/api/security', { ...jsonPost({ ssoOnly: true, requireTwoFactor: true }, owner.cookie), method: 'PATCH' })
      expect(changed.status).toBe(200); expect(await changed.json()).toMatchObject({ security: { ssoOnly: true, requireTwoFactor: true } })
      expect((await h.database.db.select({ event: auditLog.event }).from(auditLog).where(eq(auditLog.event, 'security.setting_changed')))).toHaveLength(1)
    } finally { h.close() }
  })

  it('enrols TOTP, accepts a backup code, and disables two-factor', async () => {
    const h = await harness({ publicAppUrl: 'http://app.example.test', trustedOrigins: ['http://app.example.test'] })
    try {
      const user = await signedIn(h, { email: 'twofactor@example.test', role: 'owner' })
      const enabled = await h.app.request('http://app.example.test/api/auth/two-factor/enable', jsonPost({ password: TEST_PASSWORD, method: 'totp' }, user.cookie))
      expect(enabled.status).toBe(200)
      const setup = await enabled.json() as { totpURI: string; backupCodes: string[] }
      const encodedSecret = new URL(setup.totpURI).searchParams.get('secret')!
      const secret = new TextDecoder().decode(base32.decode(encodedSecret))
      const code = await createOTP(secret).totp()
      const setupCookie = responseCookies(enabled, user.cookie)
      const verified = await h.app.request('http://app.example.test/api/auth/two-factor/verify-totp', jsonPost({ code, trustDevice: true }, setupCookie))
      expect(verified.status, await verified.clone().text()).toBe(200)
      expect(await h.database.db.select().from(auditLog).where(eq(auditLog.event, 'auth.two_factor_enabled'))).toHaveLength(1)
      const verificationCookie = responseCookies(verified, user.cookie)
      const signedOut = await h.app.request('http://app.example.test/api/auth/sign-out', jsonPost({}, verificationCookie))
      expect(signedOut.status).toBe(200)
      const login = await h.app.request('http://app.example.test/api/auth/sign-in/email', jsonPost({ email: 'twofactor@example.test', password: TEST_PASSWORD }))
      expect(await login.clone().json()).toMatchObject({ twoFactorRedirect: true })
      const challengeCookie = responseCookies(login)
      expect(challengeCookie).toBeTruthy()
      const backup = await h.app.request('http://app.example.test/api/auth/two-factor/verify-backup-code', jsonPost({ code: setup.backupCodes[0], trustDevice: true }, challengeCookie))
      expect(backup.status).toBe(200)
      const activeCookie = responseCookies(backup)
      expect(activeCookie).toBeTruthy()
      expect((await h.app.request('http://app.example.test/api/auth/two-factor/disable', jsonPost({ password: TEST_PASSWORD }, activeCookie))).status).toBe(200)
      expect(await h.database.db.select().from(auditLog).where(eq(auditLog.event, 'auth.two_factor_disabled'))).toHaveLength(1)
    } finally { h.close() }
  })

  it('requires enrolment for credential users and exempts SSO accounts', async () => {
    const h = await harness()
    try {
      const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
      const credential = await signedIn(h, { email: 'credential@example.test' })
      const federated = await signedIn(h, { email: 'sso@example.test' })
      await h.database.db.insert(account).values({ id: createId('account'), accountId: 'sso-subject', providerId: 'company-sso', userId: federated.user.id, createdAt: new Date(), updatedAt: new Date() })
      const row = (await h.database.db.select({ settings: workspace.settings }).from(workspace).limit(1))[0]!
      await h.database.db.update(workspace).set({ settings: { ...row.settings, auth: { ssoOnly: false, requireTwoFactor: true } } })
      const blocked = await h.app.request('/api/protected', { headers: { cookie: credential.cookie } })
      expect(blocked.status).toBe(403); expect(await blocked.json()).toMatchObject({ code: 'two_factor_required' })
      expect((await h.app.request('/api/protected', { headers: { cookie: federated.cookie } })).status).toBe(200)
      expect((await h.app.request('/api/security', { headers: { cookie: owner.cookie } })).status).toBe(200)
    } finally { h.close() }
  })

  it('rejects a credential user WebSocket upgrade until enrolment', async () => {
    const h = await harness()
    const hub = new RealtimeHub(h.database.db, h.auth)
    const server = createServer(); hub.attach(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const user = await signedIn(h, { email: 'socket@example.test', role: 'owner' })
      const row = (await h.database.db.select({ settings: workspace.settings }).from(workspace).limit(1))[0]!
      await h.database.db.update(workspace).set({ settings: { ...row.settings, auth: { ssoOnly: false, requireTwoFactor: true } } })
      const port = (server.address() as { port: number }).port
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: user.cookie } })
      const status = await new Promise<number | undefined>((resolve) => socket.once('unexpected-response', (_request, response) => resolve(response.statusCode)))
      expect(status).toBe(403)
    } finally {
      hub.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      h.close()
    }
  })
})

describe('member administration', () => {
  it('bans a member, removes sessions, blocks sign-in, and restores access on unban', async () => {
    const h = await harness()
    try {
      const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
      const member = await signedIn(h, { email: 'member@example.test' })
      const banned = await h.app.request(`/api/members/${member.user.id}/ban`, jsonPost({ reason: 'Policy violation', expiresIn: 3600 }, owner.cookie))
      expect(banned.status).toBe(200)
      expect(await h.database.db.select().from(sessions).where(eq(sessions.userId, member.user.id))).toHaveLength(0)
      expect((await h.app.request('/api/auth/sign-in/email', jsonPost({ email: member.user.email, password: TEST_PASSWORD }))).status).toBe(403)
      expect((await h.app.request(`/api/members/${member.user.id}/unban`, jsonPost({}, owner.cookie))).status).toBe(200)
      expect((await h.app.request('/api/auth/sign-in/email', jsonPost({ email: member.user.email, password: TEST_PASSWORD }))).status).toBe(200)
    } finally { h.close() }
  })

  it('transfers ownership atomically and rejects a non-owner caller', async () => {
    const h = await harness()
    try {
      const owner = await signedIn(h, { email: 'owner@example.test', role: 'owner' })
      const target = await signedIn(h, { email: 'target@example.test', role: 'member' })
      const other = await signedIn(h, { email: 'other@example.test', role: 'member' })
      expect((await h.app.request(`/api/members/${other.user.id}/transfer-ownership`, jsonPost({}, target.cookie))).status).toBe(403)
      expect((await h.app.request(`/api/members/${target.user.id}/transfer-ownership`, jsonPost({}, owner.cookie))).status).toBe(200)
      const roles = await h.database.db.select({ id: users.id, role: users.role }).from(users)
      expect(roles.find((row) => row.id === owner.user.id)?.role).toBe('admin')
      expect(roles.find((row) => row.id === target.user.id)?.role).toBe('owner')
      expect(roles.filter((row) => row.role === 'owner')).toHaveLength(1)
    } finally { h.close() }
  })
})
