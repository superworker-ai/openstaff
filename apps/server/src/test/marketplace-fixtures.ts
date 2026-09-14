import { vi } from 'vitest'
import type { ComposioClient, ComposioToolkit } from '../composio/client.js'

export const toolkitRows: ComposioToolkit[] = Array.from({ length: 70 }, (_, index) => ({ slug: `app-${String(index).padStart(3, '0')}`, name: `App ${String(index).padStart(3, '0')}`, description: 'Connect your workspace to this app.' }))
export const skillRows = Array.from({ length: 70 }, (_, index) => ({ name: `skill-${String(index).padStart(3, '0')}`, source: `./skill-${index}`, description: 'A skill for your teammates.', hasMcp: false }))
export function marketplaceClient(): ComposioClient {
  return {
    connections: vi.fn(async () => []), search: async () => [],
    metadata: async (slug) => ({ slug, toolkit: 'app', description: '' }), execute: async () => ({}),
    link: async () => ({ redirectUrl: 'https://example.com' }), toolkits: vi.fn(async () => toolkitRows),
    toolkitPage: vi.fn(async ({ limit, search }) => {
      const rows = toolkitRows.filter((row) => !search || row.name.toLowerCase().includes(search.toLowerCase()))
      return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? 'page2' : null, total: rows.length }
    }),
  }
}
