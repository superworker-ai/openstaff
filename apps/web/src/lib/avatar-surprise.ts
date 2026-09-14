import { BOT_ACCESSORIES, BOT_COLORS, BOT_EYES, BOT_MOUTHS, BOT_PERSONALITIES, BOT_SHAPES, resolveAvatar, type Avatar } from '@openstaff/shared'

function sample<T>(values: readonly T[], random: () => number): T {
  let value = .5
  try { const next = random(); if (Number.isFinite(next) && next >= 0 && next <= 1) value = next } catch { /* use the middle */ }
  return values[Math.min(values.length - 1, Math.floor(value * values.length))]!
}

export function surpriseAvatar(current: Avatar, random: () => number = Math.random): Avatar {
  const next = { shape: sample(BOT_SHAPES, random), color: sample(BOT_COLORS, random), eyes: sample(BOT_EYES, random), mouth: sample(BOT_MOUTHS, random), accessory: sample(BOT_ACCESSORIES, random), personality: sample(BOT_PERSONALITIES, random) }
  const resolved = resolveAvatar(current)
  if (Object.keys(next).every((key) => next[key as keyof typeof next] === resolved[key as keyof typeof resolved])) next.personality = BOT_PERSONALITIES[(BOT_PERSONALITIES.indexOf(next.personality) + 1) % BOT_PERSONALITIES.length]!
  return next
}
