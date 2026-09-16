import type { Message } from './schemas.js'

export function messagePreview(message: Pick<Message, 'authorKind' | 'attachments' | 'text'>, limit = 160): string {
  const approval = message.authorKind === 'system' && message.attachments.find((item) => item.subtype === 'approval')
  return approval ? approval.kind === 'connect' ? `${approval.botName ?? 'Bot'} needs ${approval.appName} connected` : `${approval.botName ?? 'Bot'} needs approval` : message.text.slice(0, limit)
}
