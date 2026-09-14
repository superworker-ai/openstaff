import { useEffect, useState, type ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import type { RouterContext } from '../router'
import '../styles.css'

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'OpenStaff' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  return <RootDocument><QueryClientProvider client={queryClient}><Outlet /></QueryClientProvider></RootDocument>
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])
  return <html><head><HeadContent /></head><body data-hydrated={hydrated}>{children}<Scripts /></body></html>
}
