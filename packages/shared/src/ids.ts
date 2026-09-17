import { ulid } from 'ulid'

export const idPrefixes = {
  user: 'usr_',
  session: 'ses_',
  account: 'acc_',
  verification: 'ver_',
  twoFactor: 'tfa_',
  ssoProvider: 'sso_',
  invitation: 'ivt_',
  audit: 'aud_',
  bot: 'bot_',
  room: 'room_',
  message: 'msg_',
  turn: 'turn_',
  approval: 'apr_',
  task: 'task_',
  event: 'evt_',
  plugin: 'plg_',
  automation: 'aut_',
  invocation: 'inv_',
  run: 'run_',
  connection: 'con_',
} as const

export type IdKind = keyof typeof idPrefixes

export function createId(kind: IdKind): string {
  return `${idPrefixes[kind]}${ulid()}`
}

export function isId(kind: IdKind, value: string): boolean {
  return value.startsWith(idPrefixes[kind]) && value.length === idPrefixes[kind].length + 26
}
