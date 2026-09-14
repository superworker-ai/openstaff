import type { Avatar } from './schemas.js'

export interface ResolvedAvatar extends Avatar {
  eyes: NonNullable<Avatar['eyes']>
  mouth: NonNullable<Avatar['mouth']>
  accessory: NonNullable<Avatar['accessory']>
  personality: NonNullable<Avatar['personality']>
}

export function resolveAvatar(avatar: Avatar): ResolvedAvatar {
  return { ...avatar, eyes: avatar.eyes ?? 'dot', mouth: avatar.mouth ?? 'smile', accessory: avatar.accessory ?? 'none', personality: avatar.personality ?? 'playful' }
}

export const PERSONALITY_META: Record<ResolvedAvatar['personality'], { label: string; description: string }> = {
  calm: { label: 'Calm', description: 'Small hops, long rests' },
  playful: { label: 'Playful', description: 'Bouncy and friendly' },
  curious: { label: 'Curious', description: 'Peeks around, tilts its head' },
  gremlin: { label: 'Gremlin', description: 'Big jumps, spins, no chill' },
}
