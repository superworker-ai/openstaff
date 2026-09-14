import path from 'node:path'
import { DEFAULT_CONTEXT_MESSAGES, DEFAULT_MAX_CONCURRENT_TURNS, DEFAULT_MODEL } from '@openstaff/shared'

export interface Config {
  dataDir: string
  port: number
  maxConcurrentTurns: number
  contextMessages: number
  defaultModel: string
  publicAppUrl?: string
  signupCode?: string
}

export function readConfig(overrides: Partial<Config> = {}): Config {
  const configuredDataDir = overrides.dataDir ?? process.env.DATA_DIR ?? './data'
  return {
    dataDir: path.isAbsolute(configuredDataDir) ? configuredDataDir : path.resolve(import.meta.dirname, '../../..', configuredDataDir),
    port: overrides.port ?? Number(process.env.SERVER_PORT ?? 8787),
    maxConcurrentTurns: overrides.maxConcurrentTurns ?? Number(process.env.MAX_CONCURRENT_TURNS ?? DEFAULT_MAX_CONCURRENT_TURNS),
    contextMessages: overrides.contextMessages ?? Number(process.env.CONTEXT_MESSAGES ?? DEFAULT_CONTEXT_MESSAGES),
    defaultModel: overrides.defaultModel ?? process.env.DEFAULT_MODEL ?? DEFAULT_MODEL,
    publicAppUrl: overrides.publicAppUrl ?? process.env.PUBLIC_APP_URL,
    signupCode: overrides.signupCode ?? process.env.SIGNUP_CODE,
  }
}
