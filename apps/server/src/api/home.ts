import { createHash } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import { generateText } from 'ai'
import { Hono } from 'hono'
import {
  appSlug,
  computerActivityLine,
  messagePreview,
  type HomeDigest,
  type HomeDoneItem,
  type HomeFeed,
  type HomeNeedsYouItem,
  type HomeNowItem,
  type HomeUpcomingItem,
  type JsonValue,
} from '@openstaff/shared'
import { availableApps } from '../agent/app-catalog.js'
import { approvals, bots, messages, roomMembers, rooms, turnEvents, turns, workspace } from '../db/schema.js'
import type { ApiDependencies, AppEnv } from './context.js'

interface BuiltFeed {
  feed: HomeFeed
  fingerprint: string
}

interface DigestCacheEntry extends HomeDigest {
  expiresAt: number
  fingerprint: string
}

const digestCache = new Map<string, DigestCacheEntry>()
const terminalFailure = new Set(['failed', 'partial_failed'])

function roomLabel(room: typeof rooms.$inferSelect, roomBotIds: Map<string, string[]>, botById: Map<string, typeof bots.$inferSelect>): string {
  return room.name ?? roomBotIds.get(room.id)?.map((id) => botById.get(id)?.name).find(Boolean) ?? 'Room'
}

function fileAttachments(values: Array<Record<string, JsonValue>>): Array<{ name: string; path: string; size: number }> {
  return values.flatMap((value) => value.subtype === 'file' && typeof value.name === 'string' && typeof value.path === 'string' && typeof value.size === 'number'
    ? [{ name: value.name, path: value.path, size: value.size }]
    : [])
}

function configuredModel(dependencies: ApiDependencies): boolean {
  const configured = dependencies.keys.configured()
  return ['xai', 'anthropic', 'openai', 'opencode', 'aiGateway'].some((key) => configured[key as keyof typeof configured])
}

async function buildFeed(dependencies: ApiDependencies, userId: string): Promise<BuiltFeed> {
  const { db, automationService } = dependencies
  const generatedAt = new Date().toISOString()
  const roomRows = await db.select({ room: rooms }).from(roomMembers).innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
    .where(and(eq(roomMembers.memberKind, 'user'), eq(roomMembers.memberId, userId)))
  const roomIds = roomRows.map(({ room }) => room.id)

  if (!roomIds.length) {
    let apps: Awaited<ReturnType<typeof availableApps>> = []
    try { apps = await availableApps(dependencies.registry, dependencies.composio, userId) } catch { /* A missing provider must not break Home. */ }
    const model = configuredModel(dependencies), connected = apps.some((app) => app.status === 'connected')
    return {
      feed: { generatedAt, bots: [], needsYou: [], now: [], done: [], upcoming: [], onboarding: { model, connected, hasBots: false, complete: false } },
      fingerprint: createHash('sha256').update('empty').digest('hex'),
    }
  }

  const memberBots = await db.select({ roomId: roomMembers.roomId, bot: bots }).from(roomMembers).innerJoin(bots, eq(bots.id, roomMembers.memberId))
    .where(and(eq(roomMembers.memberKind, 'bot'), inArray(roomMembers.roomId, roomIds)))
  const botById = new Map(memberBots.map(({ bot }) => [bot.id, bot]))
  const roomBotIds = new Map<string, string[]>()
  for (const { roomId, bot } of memberBots) roomBotIds.set(roomId, [...(roomBotIds.get(roomId) ?? []), bot.id])
  const feedBots = [...botById.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const roomById = new Map(roomRows.map(({ room }) => [room.id, room]))

  const pendingApprovals = await db.select({ approval: approvals }).from(approvals)
    .where(and(inArray(approvals.roomId, roomIds), eq(approvals.status, 'pending')))
    .orderBy(asc(approvals.createdAt))
  const needsYou: HomeNeedsYouItem[] = pendingApprovals.map(({ approval }) => ({
    kind: 'approval',
    id: approval.id,
    roomId: approval.roomId,
    roomName: roomLabel(roomById.get(approval.roomId)!, roomBotIds, botById),
    botId: approval.botId,
    botName: botById.get(approval.botId)?.name ?? approval.botId,
    summary: approval.summary,
    toolName: approval.toolName,
    createdAt: approval.createdAt,
    browser: approval.toolName.startsWith('browser_'),
  }))

  let apps: Awaited<ReturnType<typeof availableApps>> = []
  try { apps = await availableApps(dependencies.registry, dependencies.composio, userId) } catch { /* Installed providers can be temporarily unavailable. */ }
  for (const app of apps.filter((item) => item.status === 'expired').sort((left, right) => left.appName.localeCompare(right.appName))) {
    needsYou.push({
      kind: 'connection', id: app.slug, slug: app.slug, appName: app.appName, status: 'expired',
      botIds: feedBots.filter((bot) => bot.suggestedApps?.some((slug) => appSlug(slug) === app.slug)).map((bot) => bot.id),
    })
  }

  let automationList: Awaited<ReturnType<typeof automationService.list>> = []
  try { automationList = await automationService.list(roomIds) } catch { /* Home still renders if automation history cannot be refreshed. */ }
  const invocationIds: string[] = []
  for (const automation of automationList) {
    try {
      const history = await automationService.history(automation.id, { limit: 50 })
      const latest = history[0]
      if (latest) invocationIds.push(latest.id)
      const lastSuccess = history.find((invocation) => invocation.status === 'completed')
      if (!latest || !terminalFailure.has(latest.status) || (lastSuccess && latest.createdAt <= lastSuccess.createdAt)) continue
      const failedRun = latest.runs.find((run) => run.status === 'failed') ?? latest.runs.find((run) => run.error) ?? latest.runs[0]
      needsYou.push({
        kind: 'automation_failed', id: latest.id, automationId: automation.id, automationName: automation.name,
        roomId: automation.roomId, botName: failedRun?.botName ?? automation.targetBotIds.map((id) => botById.get(id)?.name).find(Boolean) ?? 'Bot',
        error: failedRun?.error ?? latest.skipReason ?? 'Automation run failed', failedAt: latest.completedAt ?? latest.createdAt, nextRunAt: automation.nextRunAt,
      })
    } catch { /* One malformed invocation must not hide the rest of Home. */ }
  }

  const activeTurns = await db.select().from(turns).where(and(inArray(turns.roomId, roomIds), inArray(turns.status, ['running', 'waiting_approval']))).orderBy(asc(turns.startedAt))
  const activeEvents = activeTurns.length
    ? await db.select().from(turnEvents).where(inArray(turnEvents.turnId, activeTurns.map((turn) => turn.id))).orderBy(asc(turnEvents.seq))
    : []
  const eventsByTurn = new Map<string, typeof activeEvents>()
  for (const event of activeEvents) eventsByTurn.set(event.turnId, [...(eventsByTurn.get(event.turnId) ?? []), event])
  const now: HomeNowItem[] = activeTurns.map((turn) => {
    const events = eventsByTurn.get(turn.id) ?? []
    const newestToolCall = events.findLast((event) => event.type === 'tool-call')
    const newestScreenshot = events.findLast((event) => event.type === 'screenshot')
    return {
      turnId: turn.id, roomId: turn.roomId, roomName: roomLabel(roomById.get(turn.roomId)!, roomBotIds, botById),
      botId: turn.botId, botName: botById.get(turn.botId)?.name ?? turn.botId,
      startedAt: turn.startedAt ?? events[0]?.createdAt ?? generatedAt,
      toolCalls: events.filter((event) => event.type === 'tool-call').length,
      lastAction: newestToolCall ? computerActivityLine(newestToolCall) : null,
      screenshotUrl: typeof newestScreenshot?.payload.url === 'string' ? newestScreenshot.payload.url : null,
    }
  })

  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const finishedTurns = await db.select().from(turns).where(and(
    inArray(turns.roomId, roomIds), inArray(turns.status, ['done', 'failed']), gte(turns.finishedAt, cutoff),
  )).orderBy(desc(turns.finishedAt)).limit(20)
  const botMessages = finishedTurns.length
    ? await db.select().from(messages).where(and(inArray(messages.turnId, finishedTurns.map((turn) => turn.id)), eq(messages.authorKind, 'bot'))).orderBy(asc(messages.createdAt), asc(messages.seq))
    : []
  const lastMessageByTurn = new Map<string, typeof botMessages[number]>()
  for (const message of botMessages) if (message.turnId) lastMessageByTurn.set(message.turnId, message)
  const done: HomeDoneItem[] = finishedTurns.flatMap((turn) => {
    if (!turn.finishedAt) return []
    const message = lastMessageByTurn.get(turn.id)
    const preview = message ? messagePreview({ ...message, text: message.text.trim() }, 200) : ''
    const summary = turn.status === 'failed' ? ((turn.error ?? preview) || 'Task failed') : preview
    return [{
      turnId: turn.id, roomId: turn.roomId, roomName: roomLabel(roomById.get(turn.roomId)!, roomBotIds, botById),
      botId: turn.botId, botName: botById.get(turn.botId)?.name ?? turn.botId, finishedAt: turn.finishedAt,
      status: turn.status === 'failed' ? 'failed' : 'done', summary, attachments: message ? fileAttachments(message.attachments) : [], error: turn.status === 'failed' ? turn.error : null,
    }]
  })

  const upcoming: HomeUpcomingItem[] = automationList
    .filter((automation): automation is typeof automation & { nextRunAt: string } => automation.enabled && Boolean(automation.nextRunAt) && automation.nextRunAt! > generatedAt)
    .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt)).slice(0, 10)
    .map((automation) => ({
      automationId: automation.id, name: automation.name, roomId: automation.roomId,
      botNames: automation.targetBotIds.map((id) => botById.get(id)?.name).filter((name): name is string => Boolean(name)), nextRunAt: automation.nextRunAt,
    }))

  const model = configuredModel(dependencies), connected = apps.some((app) => app.status === 'connected'), hasBots = feedBots.length > 0
  const fingerprintInputs = [
    ...now.map((turn) => `now:${turn.turnId}`), ...done.map((turn) => `done:${turn.turnId}`),
    ...pendingApprovals.map(({ approval }) => `approval:${approval.id}`), ...invocationIds.map((id) => `invocation:${id}`),
  ].sort()
  return {
    feed: { generatedAt, bots: feedBots, needsYou, now, done, upcoming, onboarding: { model, connected, hasBots, complete: model && connected && hasBots } },
    fingerprint: createHash('sha256').update(fingerprintInputs.join('|')).digest('hex'),
  }
}

function names(values: string[]): string {
  const unique = [...new Set(values)]
  if (unique.length < 2) return unique[0] ?? 'The team'
  return `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`
}

function countWord(value: number): string {
  return ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][value] ?? String(value)
}

function templateDigest(feed: HomeFeed): string {
  const updates: string[] = []
  if (feed.done.length) updates.push(`${names(feed.done.map((item) => item.botName))} finished ${feed.done.length} task${feed.done.length === 1 ? '' : 's'}`)
  if (feed.now.length) {
    const workers = [...new Set(feed.now.map((item) => item.botName))]
    updates.push(`${names(workers)} ${workers.length === 1 ? 'is' : 'are'} working on ${feed.now.length}`)
  }
  const activity = updates.length ? updates.join(' and ') : 'the team has no finished or active work'
  const attention = feed.needsYou.length ? `${countWord(feed.needsYou.length)} thing${feed.needsYou.length === 1 ? '' : 's'} need you.` : 'Nothing needs you.'
  return `Since yesterday, ${activity}. ${attention}`
}

function compactFeed(feed: HomeFeed) {
  return {
    bots: feed.bots.map((bot) => bot.name),
    done: feed.done.map((item) => ({ turnId: item.turnId, botName: item.botName, roomName: item.roomName, status: item.status, summary: item.summary, attachments: item.attachments.map((file) => file.name), error: item.error })),
    needsYou: feed.needsYou.map((item) => item.kind === 'approval'
      ? { kind: item.kind, id: item.id, botName: item.botName, roomName: item.roomName, summary: item.summary }
      : item.kind === 'connection'
        ? { kind: item.kind, id: item.id, appName: item.appName, botIds: item.botIds }
        : { kind: item.kind, id: item.id, automationName: item.automationName, botName: item.botName, error: item.error }),
    now: feed.now.map((item) => ({ turnId: item.turnId, botName: item.botName, roomName: item.roomName, startedAt: item.startedAt, toolCalls: item.toolCalls, lastAction: item.lastAction })),
  }
}

export function homeRoutes(dependencies: ApiDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.get('/feed', async (context) => context.json((await buildFeed(dependencies, context.get('user').id)).feed))
  app.get('/digest', async (context) => {
    const userId = context.get('user').id
    const built = await buildFeed(dependencies, userId)
    const cached = digestCache.get(userId)
    if (cached && cached.expiresAt > Date.now() && cached.fingerprint === built.fingerprint) {
      return context.json({ text: cached.text, generatedAt: cached.generatedAt, source: cached.source })
    }
    const generatedAt = new Date().toISOString()
    let result: HomeDigest = { text: templateDigest(built.feed), generatedAt, source: 'template' }
    try {
      const settings = (await dependencies.db.select().from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]
      if (!settings) throw new Error('Workspace settings unavailable')
      const generated = await generateText({
        model: dependencies.modelResolver(settings.defaultModel, { sessionId: `home-digest:${userId}` }),
        temperature: 0.3,
        maxOutputTokens: 160,
        prompt: `Summarize this team activity in one paragraph of 2 to 4 sentences. Use plain language. Use present tense for running work. Bold every bot name with **Name**. Do not use bullets or a preamble.\n\n${JSON.stringify(compactFeed(built.feed))}`,
      })
      if (generated.text.trim()) result = { text: generated.text.trim(), generatedAt, source: 'model' }
    } catch { /* A digest is optional; the deterministic summary is always safe. */ }
    digestCache.set(userId, { ...result, fingerprint: built.fingerprint, expiresAt: Date.now() + 10 * 60_000 })
    return context.json(result)
  })
  return app
}
