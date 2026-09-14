import type { MarketplaceEntry, PluginManifest } from './plugins/types.js'

export interface MarketplaceApp {
  slug: string
  name: string
  description: string
  logo?: string
  aliases: string[]
  status: string
  toolkit: string
  plugins: Array<{ name: string; id?: string }>
}
export interface MarketplaceSkill extends MarketplaceEntry { installed: boolean; manifest?: PluginManifest }
export interface MarketplacePageInfo { nextCursor: string | null; total: number; configured: boolean; warming: boolean }
export interface MarketplaceAppsPage extends MarketplacePageInfo { apps: MarketplaceApp[] }
export interface MarketplaceSkillsPage extends MarketplacePageInfo { skills: MarketplaceSkill[] }
