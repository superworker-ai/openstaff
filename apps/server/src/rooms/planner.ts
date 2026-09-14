import { MAX_HANDOFF_DEPTH } from '@openstaff/shared'

export interface PlanMember {
  id: string
}

export interface PlannerMention {
  kind: 'user' | 'bot'
  id: string
  handoff?: true
}

export interface PlanTurnsInput {
  roomKind: 'dm' | 'group'
  authorKind: 'user' | 'bot' | 'system'
  botMembers: PlanMember[]
  mentions: PlannerMention[]
  handoffDepth?: number
  automationBotIds?: string[]
}

export interface TurnPlan {
  botId: string
  replyMode: 'direct' | 'optional'
  handoffDepth: number
}

export function planTurns(input: PlanTurnsInput): TurnPlan[] {
  const memberIds = new Set(input.botMembers.map((member) => member.id))
  const mentionedBotIds = input.mentions
    .filter((mention) => mention.kind === 'bot' && memberIds.has(mention.id) && (input.authorKind !== 'bot' || mention.handoff === true))
    .map((mention) => mention.id)
    .filter((id, index, ids) => ids.indexOf(id) === index)
  const depth = input.handoffDepth ?? 0

  if (input.authorKind === 'system') {
    return (input.automationBotIds ?? []).filter((botId, index, ids) => memberIds.has(botId) && ids.indexOf(botId) === index)
      .map((botId) => ({ botId, replyMode: 'direct', handoffDepth: depth }))
  }

  if (input.authorKind === 'bot') {
    if (depth >= MAX_HANDOFF_DEPTH) return []
    return mentionedBotIds.map((botId) => ({ botId, replyMode: 'direct', handoffDepth: depth + 1 }))
  }

  if (input.roomKind === 'dm') {
    const bot = input.botMembers[0]
    return bot ? [{ botId: bot.id, replyMode: 'direct', handoffDepth: depth }] : []
  }

  const mentioned = new Set(mentionedBotIds)
  const direct = mentionedBotIds.map((botId) => ({ botId, replyMode: 'direct' as const, handoffDepth: depth }))
  const optional = input.botMembers
    .filter((bot) => !mentioned.has(bot.id))
    .map((bot) => ({ botId: bot.id, replyMode: 'optional' as const, handoffDepth: depth }))
  return [...direct, ...optional]
}
