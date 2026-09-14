import type { Mention } from '@openstaff/shared'

export interface MentionCandidate {
  kind: 'user' | 'bot'
  id: string
  name: string
  slug?: string
}

interface Alias extends MentionCandidate {
  label: string
}

function isBoundary(value: string | undefined): boolean {
  return value === undefined || !/[\p{L}\p{N}_-]/u.test(value)
}

export function parseMentions(
  text: string,
  candidates: MentionCandidate[],
  explicit: Mention[] = [],
): Mention[] {
  const aliases: Alias[] = candidates.flatMap((candidate) => {
    const labels = [candidate.name, candidate.slug].filter((label): label is string => Boolean(label))
    return labels.map((label) => ({ ...candidate, label }))
  }).sort((left, right) => right.label.length - left.label.length)
  const lower = text.toLocaleLowerCase()
  const found: Array<{ index: number; kind: 'user' | 'bot'; id: string }> = []

  for (let index = 0; index < lower.length; index += 1) {
    if (lower[index] !== '@') continue
    const alias = aliases.find((item) => {
      const start = index + 1
      const end = start + item.label.length
      return lower.slice(start, end) === item.label.toLocaleLowerCase() && isBoundary(lower[end])
    })
    if (!alias) continue
    found.push({ index, kind: alias.kind, id: alias.id })
    index += alias.label.length
  }

  const result = [...found.sort((left, right) => left.index - right.index), ...explicit]
  return result
    .map(({ kind, id }) => ({ kind, id, ...(explicit.some((item) => item.kind === kind && item.id === id && item.handoff) ? { handoff: true as const } : {}) }))
    .filter((mention, index, mentions) => mentions.findIndex((item) => item.kind === mention.kind && item.id === mention.id) === index)
}
