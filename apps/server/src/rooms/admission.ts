import { and, asc, eq, max } from 'drizzle-orm'
import { createId, messagePreview, type JsonValue, type Message, type Mention, type PublicTurn, type Turn } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { bots, messages, roomMembers, rooms, turns, users, workspace } from '../db/schema.js'
import { publicTurn } from '../db/public.js'
import type { RealtimeHub } from '../realtime/hub.js'
import { parseMentions, type MentionCandidate } from './mentions.js'
import { planTurns } from './planner.js'

export interface PostMessageInput {
  roomId: string
  authorKind: 'user' | 'bot' | 'system'
  authorId: string | null
  text: string
  clientRequestId?: string | null
  attachments?: Array<Record<string, JsonValue>>
  explicitMentions?: Mention[]
  turnId?: string | null
  handoffDepth?: number
  automationBotIds?: string[]
  planReplies?: boolean
  beforeEnqueue?: (result: { message: Message; turns: Turn[] }) => Promise<void>
}

export interface AdmissionResult {
  message: Message
  turns: PublicTurn[]
  deduplicated: boolean
}

class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => current)
    this.tails.set(key, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

export class AdmissionService {
  private readonly queue = new KeyedSerialQueue()
  private enqueueTurns: (turns: Turn[]) => void = () => undefined

  constructor(private readonly db: Database, private readonly hub?: RealtimeHub) {}

  setTurnEnqueuer(enqueue: (newTurns: Turn[]) => void): void {
    this.enqueueTurns = enqueue
  }

  async post(input: PostMessageInput): Promise<AdmissionResult> {
    return this.queue.run(input.roomId, async () => {
      if (input.clientRequestId && input.authorId) {
        const existing = (await this.db.select().from(messages).where(and(
          eq(messages.authorKind, input.authorKind),
          eq(messages.authorId, input.authorId),
          eq(messages.clientRequestId, input.clientRequestId),
        )).limit(1))[0]
        if (existing) return { message: existing, turns: [], deduplicated: true }
      }

      const room = (await this.db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1))[0]
      if (!room) throw new Error('Room not found')
      const botRows = await this.db.select({ bot: bots }).from(roomMembers)
        .innerJoin(bots, eq(roomMembers.memberId, bots.id))
        .where(and(eq(roomMembers.roomId, input.roomId), eq(roomMembers.memberKind, 'bot')))
        .orderBy(asc(roomMembers.joinedAt))
      const userRows = await this.db.select({ user: users }).from(roomMembers)
        .innerJoin(users, eq(roomMembers.memberId, users.id))
        .where(and(eq(roomMembers.roomId, input.roomId), eq(roomMembers.memberKind, 'user')))
      const candidates: MentionCandidate[] = [
        ...botRows.map(({ bot }) => ({ kind: 'bot' as const, id: bot.id, name: bot.name, slug: bot.slug })),
        ...userRows.map(({ user }) => ({ kind: 'user' as const, id: user.id, name: user.name })),
      ]
      const normalizedMentions = parseMentions(input.text, candidates, input.explicitMentions)
      const now = new Date().toISOString()
      const id = createId('message')
      const currentSeq = (await this.db.select({ value: max(messages.seq) }).from(messages).where(eq(messages.roomId, input.roomId)))[0]?.value ?? 0
      const message: typeof messages.$inferInsert = {
        id,
        roomId: input.roomId,
        seq: currentSeq + 1,
        authorKind: input.authorKind,
        authorId: input.authorId,
        text: input.text,
        mentions: normalizedMentions,
        attachments: input.attachments ?? [],
        turnId: input.turnId ?? null,
        clientRequestId: input.clientRequestId ?? null,
        createdAt: now,
      }
      const workspaceRow = (await this.db.select().from(workspace).where(eq(workspace.id, 'workspace')).limit(1))[0]
      const plans = input.planReplies === false ? [] : planTurns({
        roomKind: room.kind,
        authorKind: input.authorKind,
        botMembers: botRows.map(({ bot }) => ({ id: bot.id })),
        mentions: normalizedMentions,
        handoffDepth: input.handoffDepth,
        automationBotIds: input.automationBotIds,
      })
      const newTurns: Array<typeof turns.$inferInsert> = plans.map((plan) => {
        const bot = botRows.find((row) => row.bot.id === plan.botId)?.bot
        if (!bot) throw new Error('Planned bot is not a room member')
        return {
          id: createId('turn'),
          roomId: input.roomId,
          botId: plan.botId,
          triggerMessageId: id,
          replyMode: plan.replyMode,
          status: 'queued',
          model: bot.model ?? workspaceRow?.defaultModel ?? 'xai/grok-4.6',
          modelMessages: [],
          handoffDepth: plan.handoffDepth,
        }
      })

      await this.db.transaction(async (transaction) => {
        await transaction.insert(messages).values(message)
        await transaction.update(rooms).set({ lastMessageAt: now, lastMessagePreview: messagePreview({ ...input, attachments: input.attachments ?? [] }) }).where(eq(rooms.id, input.roomId))
        if (newTurns.length) await transaction.insert(turns).values(newTurns)
      })
      const persistedMessage = message as Message
      const persistedTurns = newTurns.map((turn) => ({
        ...turn,
        usage: turn.usage ?? null,
        error: turn.error ?? null,
        startedAt: turn.startedAt ?? null,
        finishedAt: turn.finishedAt ?? null,
      })) as Turn[]
      try { await input.beforeEnqueue?.({ message: persistedMessage, turns: persistedTurns }) } finally {
        this.hub?.broadcastRoom(input.roomId, { type: 'message.created', message: persistedMessage, ts: now })
        for (const turn of persistedTurns) this.hub?.broadcastRoom(input.roomId, { type: 'turn.updated', turn: publicTurn(turn), ts: now })
        this.enqueueTurns(persistedTurns)
      }
      return { message: persistedMessage, turns: persistedTurns.map(publicTurn), deduplicated: false }
    })
  }

  async isMember(roomId: string, kind: 'user' | 'bot', memberId: string): Promise<boolean> {
    return Boolean((await this.db.select({ roomId: roomMembers.roomId }).from(roomMembers).where(and(
      eq(roomMembers.roomId, roomId), eq(roomMembers.memberKind, kind), eq(roomMembers.memberId, memberId),
    )).limit(1))[0])
  }
}
