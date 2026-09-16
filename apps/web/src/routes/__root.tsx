import { useEffect, useState, type ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '../components/ui/tooltip'
import type { RouterContext } from '../router'
import { THEME_BOOT_SCRIPT, useTheme } from '../lib/theme'
import '../styles.css'

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#0d0d0f' },
      { title: 'OpenStaff' },
    ],
    links: [
      { rel: 'icon', href: '/brand/icon-32.png', type: 'image/png', sizes: '32x32' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/brand/apple-touch-icon.png', sizes: '180x180' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  return <RootDocument><QueryClientProvider client={queryClient}><TooltipProvider><Outlet /></TooltipProvider></QueryClientProvider></RootDocument>
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  useTheme()
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])
  return <html data-theme="dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /><HeadContent /></head><body data-hydrated={hydrated}>{children}<Scripts /></body></html>
}
