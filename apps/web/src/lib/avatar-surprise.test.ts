import { describe, expect, it } from 'vitest'
import { avatarSchema, resolveAvatar, type Avatar } from '@openstaff/shared'
import { surpriseAvatar } from './avatar-surprise'

function seeded(seed: number) {
  let value = seed >>> 0
  return () => { value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0; return value / 4_294_967_295 }
}

describe('surpriseAvatar', () => {
  const current: Avatar = { shape: 'circle', color: '#F04438', eyes: 'dot', mouth: 'smile', accessory: 'none', personality: 'playful' }
  it('is deterministic for an injected seed and schema-valid', () => {
    const first = surpriseAvatar(current, seeded(42)), second = surpriseAvatar(current, seeded(42))
    expect(first).toEqual(second)
    expect(avatarSchema.safeParse(first).success).toBe(true)
  })
  it('never returns the current persona even when every sample selects it', () => {
    const next = surpriseAvatar(current, () => 0)
    expect(resolveAvatar(next)).not.toEqual(resolveAvatar(current))
    expect(avatarSchema.safeParse(next).success).toBe(true)
  })
})
