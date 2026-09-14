import type { JsonValue } from '@openstaff/shared'

export function mergeUsage(previous: Record<string, JsonValue> | null, current: Record<string, JsonValue>): Record<string, JsonValue> {
  const result = { ...previous }
  for (const [key, value] of Object.entries(current)) {
    const old = result[key]
    result[key] = typeof value === 'number' ? (typeof old === 'number' ? old : 0) + value
      : value && typeof value === 'object' && !Array.isArray(value) ? mergeUsage(old && typeof old === 'object' && !Array.isArray(old) ? old : null, value) : value
  }
  return result
}
