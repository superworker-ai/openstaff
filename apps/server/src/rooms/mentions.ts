import type { Mention } from '@openstaff/shared'

export interface MentionCandidate {
  kind: 'user' | 'bot'
  id: string
  name: string
  slug?: string
}

interface Alias extends MentionCandidate {
  normalized: string
  words: string[]
}

function isBoundary(value: string | undefined): boolean {
  return value === undefined || !/[\p{L}\p{N}_-]/u.test(value)
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

function words(value: string): Array<{ value: string; index: number }> {
  return [...value.matchAll(/[\p{L}\p{N}_-]+/gu)].map((match) => ({ value: match[0], index: match.index }))
}

export function withinOneEdit(a: string, b: string): boolean {
  const left = [...a], right = [...b]
  if (Math.abs(left.length - right.length) > 1) return false
  if (left.length === right.length) {
    let differences = 0
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index] && ++differences > 1) return false
    }
    return true
  }

  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  let shortIndex = 0, longIndex = 0, edits = 0
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) shortIndex += 1
    else if (++edits > 1) return false
    longIndex += 1
  }
  return true
}

export function parseMentions(
  text: string,
  candidates: MentionCandidate[],
  explicit: Mention[] = [],
): Mention[] {
  const aliases: Alias[] = candidates.flatMap((candidate) => {
    const labels = [candidate.name, candidate.slug].filter((label): label is string => Boolean(label))
    return labels.map((label) => {
      const normalized = normalize(label)
      return { ...candidate, normalized, words: words(normalized).map((word) => word.value) }
    })
  }).sort((left, right) => right.normalized.length - left.normalized.length)
  const normalizedText = normalize(text)
  const textWords = words(normalizedText)
  const found: Array<{ index: number; kind: 'user' | 'bot'; id: string }> = []

  for (let index = 0; index < normalizedText.length; index += 1) {
    if (normalizedText[index] !== '@') continue
    const alias = aliases.find((item) => {
      const start = index + 1
      const end = start + item.normalized.length
      return normalizedText.slice(start, end) === item.normalized && isBoundary(normalizedText[end])
    })
    if (!alias) continue
    found.push({ index, kind: alias.kind, id: alias.id })
    index += alias.normalized.length
  }

  for (let index = 0; index < textWords.length; index += 1) {
    for (const alias of aliases) {
      if (!alias.words.length || index + alias.words.length > textWords.length) continue
      const matches = alias.words.every((labelWord, offset) => {
        const textWord = textWords[index + offset]!.value
        if (alias.words.length !== 1 || [...labelWord].length < 5 || alias.normalized.includes('-')) return labelWord === textWord
        return withinOneEdit(labelWord, textWord)
      })
      if (matches) found.push({ index: textWords[index]!.index, kind: alias.kind, id: alias.id })
    }
  }

  const result = [...found.sort((left, right) => left.index - right.index), ...explicit]
  return result
    .map(({ kind, id }) => ({ kind, id, ...(explicit.some((item) => item.kind === kind && item.id === id && item.handoff) ? { handoff: true as const } : {}) }))
    .filter((mention, index, mentions) => mentions.findIndex((item) => item.kind === mention.kind && item.id === mention.id) === index)
}
