import { createRouter } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'

export interface RouterContext {
  queryClient: QueryClient
}

export function getRouter() {
  return createRouter({
    routeTree,
    context: { queryClient: new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }) },
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
