import { describe, expect, it } from 'vitest'
import { avatarSchema } from './schemas.js'
import { resolveAvatar } from './avatar.js'

describe('bot avatars', () => {
  it('resolves legacy avatars with personality defaults', () => {
    expect(resolveAvatar({ shape: 'circle', color: '#2E90FA' })).toEqual({ shape: 'circle', color: '#2E90FA', eyes: 'dot', mouth: 'smile', accessory: 'none', personality: 'playful' })
  })

  it('accepts legacy and custom hexadecimal avatars', () => {
    expect(avatarSchema.safeParse({ shape: 'blob', color: '#2E90FA' }).success).toBe(true)
    expect(avatarSchema.safeParse({ shape: 'hex', color: '#c0ffee', eyes: 'happy', mouth: 'grin', accessory: 'glasses', personality: 'gremlin' }).success).toBe(true)
  })

  it.each([
    { shape: 'circle', color: '#abc' },
    { shape: 'circle', color: 'red' },
    { shape: 'circle', color: '#123456', eyes: 'stars' },
    { shape: 'circle', color: '#123456', mouth: 'frown' },
    { shape: 'circle', color: '#123456', accessory: 'crown' },
    { shape: 'circle', color: '#123456', personality: 'sleepy' },
  ])('rejects invalid avatar values', (avatar) => {
    expect(avatarSchema.safeParse(avatar).success).toBe(false)
  })
})
