import type { Bot } from './schemas.js'

export interface HomeApprovalItem {
  kind: 'approval'
  id: string
  roomId: string
  roomName: string
  botId: string
  botName: string
  summary: string
  toolName: string
  createdAt: string
  browser: boolean
}

export interface HomeConnectionItem {
  kind: 'connection'
  id: string
  slug: string
  appName: string
  status: 'expired'
  botIds: string[]
}

export interface HomeAutomationFailedItem {
  kind: 'automation_failed'
  id: string
  automationId: string
  automationName: string
  roomId: string
  botName: string
  error: string
  failedAt: string
  nextRunAt: string | null
}

export type HomeNeedsYouItem = HomeApprovalItem | HomeConnectionItem | HomeAutomationFailedItem

export interface HomeNowItem {
  turnId: string
  roomId: string
  roomName: string
  botId: string
  botName: string
  startedAt: string
  toolCalls: number
  lastAction: string | null
  screenshotUrl: string | null
}

export interface HomeDoneItem {
  turnId: string
  roomId: string
  roomName: string
  botId: string
  botName: string
  finishedAt: string
  status: 'done' | 'failed'
  summary: string
  attachments: Array<{ name: string; path: string; size: number }>
  error: string | null
}

export interface HomeUpcomingItem {
  automationId: string
  name: string
  roomId: string
  botNames: string[]
  nextRunAt: string
}

export interface HomeOnboarding {
  model: boolean
  connected: boolean
  hasBots: boolean
  complete: boolean
}

export interface HomeFeed {
  generatedAt: string
  bots: Bot[]
  needsYou: HomeNeedsYouItem[]
  now: HomeNowItem[]
  done: HomeDoneItem[]
  upcoming: HomeUpcomingItem[]
  onboarding: HomeOnboarding
}

export interface HomeDigest {
  text: string
  generatedAt: string
  source: 'model' | 'template'
}
