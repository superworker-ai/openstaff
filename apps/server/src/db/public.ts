import { publicTurnSchema, type PublicTurn, type Turn } from '@openstaff/shared'

export function publicTurn(turn: Turn): PublicTurn {
  return publicTurnSchema.parse(turn)
}
