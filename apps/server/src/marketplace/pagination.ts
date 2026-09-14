import { createHash } from 'node:crypto'
import type { MarketplaceApp, MarketplaceSkill } from '@openstaff/shared'

export function normalizeQuery(q = '') { return q.trim().toLowerCase().slice(0, 300) }
export function clampLimit(value?: string) {
  const limit = Number(value ?? 24)
  return Number.isFinite(limit) ? Math.min(60, Math.max(1, Math.floor(limit))) : 24
}
export function revision(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24) }
export function encodeCursor(offset: number, q: string, version: string) { return Buffer.from(JSON.stringify({ offset, q, version })).toString('base64url') }
export function decodeCursor(cursor: string | undefined, q: string, version: string): number {
  try {
    if (!cursor || cursor.length > 2048) return 0
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    return value.q === q && value.version === version && Number.isSafeInteger(value.offset) && value.offset >= 0 ? value.offset : 0
  } catch { return 0 }
}
export function paginate<T>(items: T[], q: string, version: string, limit: number, cursor?: string, warming = false) {
  const requested = decodeCursor(cursor, q, version)
  const offset = warming || requested >= items.length ? 0 : requested
  const end = offset + limit
  return { items: items.slice(offset, end), total: items.length, nextCursor: !warming && end < items.length ? encodeCursor(end, q, version) : null }
}
function statusRank(app: MarketplaceApp) {
  return app.status === 'Connected' ? 0 : app.status === 'Expired' ? 1 : app.plugins.some((plugin) => plugin.id) ? 2 : 3
}
export function appRank(app: MarketplaceApp, q: string) {
  if (!q) return 0
  const name = app.name.toLowerCase(), slug = app.slug.toLowerCase()
  if (name.startsWith(q)) return 0
  if (name.includes(q) || slug.includes(q)) return 1
  if (app.aliases.some((alias) => alias.toLowerCase().includes(q))) return 2
  return app.description.toLowerCase().includes(q) ? 3 : Infinity
}
export function searchApps(apps: MarketplaceApp[], q: string) {
  return apps.filter((app) => Number.isFinite(appRank(app, q))).sort((a, b) => appRank(a, q) - appRank(b, q) || statusRank(a) - statusRank(b) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.slug.localeCompare(b.slug))
}
export function searchSkills(skills: MarketplaceSkill[], q: string) {
  const name = (skill: MarketplaceSkill) => skill.manifest?.displayName ?? skill.name
  return skills.filter((skill) => [skill.name, name(skill), skill.description, skill.manifest?.description].some((text) => text?.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.installed) - Number(a.installed) || name(a).localeCompare(name(b), 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name))
}
