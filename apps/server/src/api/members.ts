import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { createId } from '@openstaff/shared'
import { requestIp } from '../audit.js'
import { publicUser, type AppVariables } from '../auth/session.js'
import { automations, bots, computerCredentials, invitations, roomMembers, rooms, sessions, tasks, users, workspace } from '../db/schema.js'
import { invitationTemplate } from '../email/templates.js'
import { checkMemberPlan } from '../plan.js'
import type { ApiDependencies } from './context.js'
import { isResponse, parseBody, publicOrigin } from './helpers.js'

const invitationInput = z.object({ email: z.email().transform((value) => value.trim().toLowerCase()), role: z.enum(['admin', 'member']).default('member') })
const roleInput = z.object({ role: z.enum(['admin', 'member']) })
const banInput = z.object({ reason: z.string().trim().min(1).max(500).optional(), expiresAt: z.iso.datetime().nullable().optional(), expiresIn: z.number().int().positive().max(31_536_000).optional() }).strict().refine((value) => value.expiresAt === undefined || value.expiresIn === undefined, 'Use either expiresAt or expiresIn')
const invitationLifetime = 7 * 24 * 60 * 60 * 1000
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const canManage = (role: 'owner' | 'admin' | 'member') => role === 'owner' || role === 'admin'

export function publicInvitationRoutes({ db }: Pick<ApiDependencies, 'db'>): Hono {
  const app = new Hono()
  app.get('/:token', async (context) => {
    const invitation = (await db.select({ email: invitations.email, expiresAt: invitations.expiresAt }).from(invitations).where(and(
      eq(invitations.tokenHash, tokenHash(context.req.param('token'))), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date().toISOString()),
    )).limit(1))[0]
    if (!invitation) return context.json({ error: 'Invitation not found or expired', code: 'invalid_invitation' }, 404)
    const workspaceName = (await db.select({ name: workspace.name }).from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]?.name ?? 'OpenStaff'
    return context.json({ invitation: { email: invitation.email, workspaceName, expiresAt: invitation.expiresAt } })
  })
  return app
}

export function memberRoutes({ db, audit }: Pick<ApiDependencies, 'db' | 'audit'>): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (context, next) => canManage(context.get('user').role) ? next() : context.json({ error: 'Workspace administrator required' }, 403))
  app.get('/', async (context) => context.json({ members: (await db.select().from(users).orderBy(users.name)).map(publicUser) }))
  app.patch('/:id', async (context) => {
    const input = await parseBody(context, roleInput)
    if (isResponse(input)) return input
    const target = (await db.select().from(users).where(eq(users.id, context.req.param('id'))).limit(1))[0]
    if (!target) return context.json({ error: 'Member not found' }, 404)
    if (target.role === 'owner') return context.json({ error: 'Use transfer ownership to change the owner.' }, 409)
    await db.update(users).set({ role: input.role, updatedAt: new Date() }).where(eq(users.id, target.id))
    await audit({ actorUserId: context.get('user').id, actorIp: requestIp(context.req.raw.headers), event: 'member.role_changed', targetType: 'user', targetId: target.id, metadata: { from: target.role, to: input.role } })
    const updated = (await db.select().from(users).where(eq(users.id, target.id)).limit(1))[0]!
    return context.json({ member: publicUser(updated) })
  })
  app.post('/:id/ban', async (context) => {
    const input = await parseBody(context, banInput)
    if (isResponse(input)) return input
    const target = (await db.select().from(users).where(eq(users.id, context.req.param('id'))).limit(1))[0]
    if (!target) return context.json({ error: 'Member not found' }, 404)
    if (target.id === context.get('user').id) return context.json({ error: 'You cannot do this to your own account.' }, 400)
    if (target.role === 'owner') return context.json({ error: 'The workspace owner cannot be banned' }, 409)
    const banExpires = input.expiresAt ? new Date(input.expiresAt) : input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000) : null
    await db.transaction(async (tx) => {
      await tx.update(users).set({ banned: true, banReason: input.reason ?? null, banExpires, updatedAt: new Date() }).where(eq(users.id, target.id))
      await tx.delete(sessions).where(eq(sessions.userId, target.id))
    })
    await audit({ actorUserId: context.get('user').id, actorIp: requestIp(context.req.raw.headers), event: 'member.banned', targetType: 'user', targetId: target.id, metadata: { reason: input.reason ?? null, expiresAt: banExpires?.toISOString() ?? null } })
    return context.json({ member: publicUser({ ...target, banned: true, banReason: input.reason ?? null, banExpires }) })
  })
  app.post('/:id/unban', async (context) => {
    const target = (await db.select().from(users).where(eq(users.id, context.req.param('id'))).limit(1))[0]
    if (!target) return context.json({ error: 'Member not found' }, 404)
    if (target.role === 'owner') return context.json({ error: 'The workspace owner cannot be unbanned through this endpoint' }, 409)
    await db.update(users).set({ banned: false, banReason: null, banExpires: null, updatedAt: new Date() }).where(eq(users.id, target.id))
    await audit({ actorUserId: context.get('user').id, actorIp: requestIp(context.req.raw.headers), event: 'member.unbanned', targetType: 'user', targetId: target.id })
    return context.json({ member: publicUser({ ...target, banned: false, banReason: null, banExpires: null }) })
  })
  app.post('/:id/revoke-sessions', async (context) => {
    const target = (await db.select().from(users).where(eq(users.id, context.req.param('id'))).limit(1))[0]
    if (!target) return context.json({ error: 'Member not found' }, 404)
    if (target.id === context.get('user').id) return context.json({ error: 'You cannot do this to your own account.' }, 400)
    if (target.role === 'owner') return context.json({ error: 'The workspace owner sessions cannot be revoked through this endpoint' }, 409)
    await db.delete(sessions).where(eq(sessions.userId, target.id))
    await audit({ actorUserId: context.get('user').id, actorIp: requestIp(context.req.raw.headers), event: 'session.revoked', targetType: 'user', targetId: target.id, metadata: { scope: 'all' } })
    return context.json({ ok: true })
  })
  app.post('/:id/transfer-ownership', async (context) => {
    const actor = context.get('user')
    if (actor.role !== 'owner') return context.json({ error: 'Workspace owner required' }, 403)
    const target = (await db.select().from(users).where(eq(users.id, context.req.param('id'))).limit(1))[0]
    if (!target) return context.json({ error: 'Member not found' }, 404)
    if (target.role !== 'admin' && target.role !== 'member') return context.json({ error: 'Ownership can only be transferred to an administrator or member' }, 409)
    await db.transaction(async (tx) => {
      await tx.update(users).set({ role: 'admin', updatedAt: new Date() }).where(and(eq(users.id, actor.id), eq(users.role, 'owner')))
      await tx.update(users).set({ role: 'owner', updatedAt: new Date() }).where(eq(users.id, target.id))
    })
    await audit({ actorUserId: actor.id, actorIp: requestIp(context.req.raw.headers), event: 'workspace.ownership_transferred', targetType: 'user', targetId: target.id, metadata: { previousOwnerId: actor.id } })
    return context.json({ owner: publicUser({ ...target, role: 'owner' }) })
  })
  app.delete('/:id', async (context) => {
    const target = (await db.select().from(users).where(eq(users.id, context.req.param('id'))).limit(1))[0]
    if (!target) return context.json({ error: 'Member not found' }, 404)
    if (target.role === 'owner') return context.json({ error: 'The workspace owner cannot be removed' }, 409)
    if (target.id === context.get('user').id) return context.json({ error: 'You cannot remove yourself' }, 409)
    const owner = (await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).limit(1))[0]
    if (!owner) return context.json({ error: 'Workspace owner not found' }, 409)
    await db.transaction(async (tx) => {
      await tx.update(bots).set({ createdBy: owner.id }).where(eq(bots.createdBy, target.id))
      await tx.update(rooms).set({ createdBy: owner.id }).where(eq(rooms.createdBy, target.id))
      await tx.update(invitations).set({ invitedBy: owner.id }).where(eq(invitations.invitedBy, target.id))
      await tx.update(computerCredentials).set({ updatedBy: owner.id }).where(eq(computerCredentials.updatedBy, target.id))
      await tx.update(automations).set({ createdBy: owner.id }).where(eq(automations.createdBy, target.id))
      await tx.update(tasks).set({ createdById: owner.id }).where(and(eq(tasks.createdByKind, 'user'), eq(tasks.createdById, target.id)))
      await tx.delete(roomMembers).where(and(eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, target.id)))
      await tx.delete(users).where(eq(users.id, target.id))
    })
    await audit({ actorUserId: context.get('user').id, actorIp: requestIp(context.req.raw.headers), event: 'member.removed', targetType: 'user', targetId: target.id, metadata: { email: target.email } })
    return context.json({ ok: true })
  })
  return app
}

export function invitationRoutes({ db, config, sendEmail, audit }: Pick<ApiDependencies, 'db' | 'config' | 'sendEmail' | 'audit'>): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()
  // The admin needs the link itself whenever email is not configured, so every send returns it and nothing is stored.
  const deliver = async (context: Context, email: string, role: 'admin' | 'member', token: string) => {
    const workspaceName = (await db.select({ name: workspace.name }).from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]?.name ?? 'OpenStaff'
    const inviteUrl = new URL(`/invite/${token}`, publicOrigin(context, config)).toString()
    await sendEmail({ to: email, ...invitationTemplate(workspaceName, role, inviteUrl) })
    return { inviteUrl, delivery: config.email.provider === 'console' ? 'link' as const : 'email' as const }
  }
  app.get('/', async (context) => {
    if (!canManage(context.get('user').role)) return context.json({ error: 'Workspace administrator required' }, 403)
    const now = new Date().toISOString()
    const open = await db.select({ id: invitations.id, email: invitations.email, role: invitations.role, invitedBy: invitations.invitedBy, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt }).from(invitations).where(and(
      isNull(invitations.acceptedAt), isNull(invitations.revokedAt),
    )).orderBy(invitations.createdAt)
    return context.json({ invitations: open.map((row) => ({ ...row, status: row.expiresAt > now ? 'pending' as const : 'expired' as const })) })
  })
  app.post('/', async (context) => {
    if (!canManage(context.get('user').role)) return context.json({ error: 'Workspace administrator required' }, 403)
    const input = await parseBody(context, invitationInput)
    if (isResponse(input)) return input
    if ((await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1))[0]) return context.json({ error: 'A member already uses this email' }, 409)
    const existing = (await db.select({ id: invitations.id }).from(invitations).where(and(eq(invitations.email, input.email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date().toISOString()))).limit(1))[0]
    if (existing) return context.json({ error: 'A pending invitation already exists' }, 409)
    const limit = await checkMemberPlan(db, config)
    if (limit) return context.json(limit.body(), 402)
    const token = randomBytes(32).toString('base64url'), now = new Date(), id = createId('invitation')
    const invitation = { id, email: input.email, role: input.role, tokenHash: tokenHash(token), invitedBy: context.get('user').id, expiresAt: new Date(now.getTime() + invitationLifetime).toISOString(), createdAt: now.toISOString() }
    await db.insert(invitations).values(invitation)
    const sent = await deliver(context, input.email, input.role, token)
    await audit({ actorUserId: context.get('user').id, actorIp: requestIp(context.req.raw.headers), event: 'member.invited', targetType: 'invitation', targetId: id, metadata: { email: input.email, role: input.role } })
    return context.json({ invitation: { id, email: invitation.email, role: invitation.role, invitedBy: invitation.invitedBy, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt, status: 'pending' as const }, ...sent }, 201)
  })
  // Rotating the hash keeps the old link dead; an expired row is revived rather than recreated.
  app.post('/:id/resend', async (context) => {
    if (!canManage(context.get('user').role)) return context.json({ error: 'Workspace administrator required' }, 403)
    const current = (await db.select().from(invitations).where(and(eq(invitations.id, context.req.param('id')), isNull(invitations.acceptedAt))).limit(1))[0]
    if (!current) return context.json({ error: 'Invitation not found' }, 404)
    const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + invitationLifetime).toISOString()
    await db.update(invitations).set({ tokenHash: tokenHash(token), expiresAt, revokedAt: null }).where(eq(invitations.id, current.id))
    const sent = await deliver(context, current.email, current.role, token)
    await audit({ actorUserId: context.get('user').id, actorIp: requestIp(context.req.raw.headers), event: 'member.invite_resent', targetType: 'invitation', targetId: current.id, metadata: { email: current.email, role: current.role } })
    return context.json({ invitation: { id: current.id, email: current.email, role: current.role, invitedBy: current.invitedBy, expiresAt, createdAt: current.createdAt, status: 'pending' as const }, ...sent })
  })
  app.delete('/:id', async (context) => {
    if (!canManage(context.get('user').role)) return context.json({ error: 'Workspace administrator required' }, 403)
    const current = (await db.select({ id: invitations.id }).from(invitations).where(and(eq(invitations.id, context.req.param('id')), isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).limit(1))[0]
    if (!current) return context.json({ error: 'Pending invitation not found' }, 404)
    await db.update(invitations).set({ revokedAt: new Date().toISOString() }).where(eq(invitations.id, current.id))
    return context.json({ ok: true })
  })
  app.post('/:token/accept', async (context) => {
    const user = context.get('user')
    const invitation = (await db.select().from(invitations).where(and(
      eq(invitations.tokenHash, tokenHash(context.req.param('token'))), eq(invitations.email, user.email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date().toISOString()),
    )).limit(1))[0]
    if (!invitation) return context.json({ error: 'Invitation not found, expired, or for another email', code: 'invalid_invitation' }, 404)
    const at = new Date().toISOString()
    await db.transaction(async (tx) => {
      await tx.update(users).set({ role: invitation.role, updatedAt: new Date(at) }).where(and(eq(users.id, user.id), eq(users.role, 'member')))
      await tx.update(invitations).set({ acceptedAt: at }).where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    })
    await audit({ actorUserId: user.id, actorIp: requestIp(context.req.raw.headers), event: 'member.invite_accepted', targetType: 'invitation', targetId: invitation.id, metadata: { role: invitation.role } })
    return context.json({ ok: true })
  })
  return app
}
