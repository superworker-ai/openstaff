import type { Message } from './schemas.js'

export function messagePreview(message: Pick<Message, 'authorKind' | 'attachments' | 'text'>, limit = 160): string {
  const approval = message.authorKind === 'system' && message.attachments.find((item) => item.subtype === 'approval')
  return approval ? approval.kind === 'connect' ? `${approval.botName ?? 'Bot'} needs ${approval.appName} connected` : `${approval.botName ?? 'Bot'} needs approval` : message.text.slice(0, limit)
}

function stripEmphasis(text: string, marker: '*' | '_'): string {
  const escaped = marker === '*' ? '\\*' : '_'
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?=\\S)([^${escaped}\\n]*?\\S)${escaped}(?![\\p{L}\\p{N}])`, 'gu')
  return text.replace(pattern, (match, content: string) => /[\p{L}\p{N}]/u.test(content) ? content : match)
}

export function plainPreview(text: string): string {
  let preview = text
    .replace(/^[ \t]*```.*(?:\r?\n|$)/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '$1')
    .replace(/__(?=\S)([^_\n]*?\S)__/g, '$1')
    .replace(/^[ \t]*(?:(?:#{1,6}|>|[-*]|\d+\.)[ \t]+)+/gm, '')

  preview = stripEmphasis(preview, '*')
  preview = stripEmphasis(preview, '_')
  return preview.replace(/\s+/g, ' ').trim()
}
