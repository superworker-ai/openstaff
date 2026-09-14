import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { appSlug, type MarketplaceApp, type MarketplaceAppsPage, type MarketplacePageInfo, type MarketplaceSkillsPage } from '@openstaff/shared'
import { api } from '../lib/api'
import { onConnectionMessage } from '../lib/connection-popup'
import { onConnectionUpdate } from '../lib/connection-events'

export function useDebouncedSearch(value: string) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const timer = setTimeout(() => setDebounced(value.trim()), 250); return () => clearTimeout(timer) }, [value])
  return debounced
}

export function useMarketplace<T extends MarketplacePageInfo>(tab: 'apps' | 'skills', q: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['marketplace', tab, q], enabled, initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ q, limit: '24' })
      if (pageParam) params.set('cursor', pageParam)
      return api<T>(`/api/marketplace/${tab}?${params}`, { signal })
    },
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: (query) => enabled && query.state.data?.pages.some((page) => page.warming) ? 3000 : false,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
  })
}

export function useMarketplaceUpdates() {
  const client = useQueryClient()
  const patchApp = (app: MarketplaceApp, configured: boolean) => client.setQueriesData<InfiniteData<MarketplaceAppsPage>>({ queryKey: ['marketplace', 'apps'] }, (data) => data && ({ ...data, pages: data.pages.map((page) => ({ ...page, configured, apps: page.apps.map((item) => item.slug === app.slug ? app : item) })) }))
  const refreshApp = async (slug: string) => {
    const result = await api<{ app: MarketplaceApp; configured: boolean }>(`/api/marketplace/apps/${encodeURIComponent(slug)}`)
    patchApp(result.app, result.configured)
  }
  useEffect(() => {
    const refresh = ({ app }: { app: string }) => {
      const cached = client.getQueriesData<InfiniteData<MarketplaceAppsPage>>({ queryKey: ['marketplace', 'apps'] })
      const items = cached.flatMap(([, data]) => data?.pages.flatMap((page) => page.apps) ?? [])
      const slugs = new Set(items.filter((item) => [item.slug, item.name, ...item.aliases].some((alias) => appSlug(alias) === appSlug(app))).map((item) => item.slug))
      for (const slug of slugs) void refreshApp(slug).catch(() => { /* Retain the current card if the refresh fails. */ })
    }
    const offMessage = onConnectionMessage(refresh), offUpdate = onConnectionUpdate(refresh)
    return () => { offMessage(); offUpdate() }
  }, [client]) // Card refreshes patch all cached searches, never invalidate their pages.
  const installedSkill = (name: string) => client.setQueriesData<InfiniteData<MarketplaceSkillsPage>>({ queryKey: ['marketplace', 'skills'] }, (data) => data && ({ ...data, pages: data.pages.map((page) => ({ ...page, skills: page.skills.map((item) => item.name === name ? { ...item, installed: true } : item) })) }))
  const configured = () => client.setQueriesData<InfiniteData<MarketplaceAppsPage>>({ queryKey: ['marketplace', 'apps'] }, (data) => data && ({ ...data, pages: data.pages.map((page) => ({ ...page, configured: true, warming: true })) }))
  return { refreshApp, installedSkill, configured }
}
