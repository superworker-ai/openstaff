import { useEffect, useState, type ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, useLocation } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '../components/ui/tooltip'
import type { RouterContext } from '../router'
import { THEME_BOOT_SCRIPT, useTheme } from '../lib/theme'
import '../styles.css'
import { loadPlan } from '../lib/loaders'
import { PlanProvider, usePlan } from '../hooks/usePlan'

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: () => loadPlan(),
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
  const plan = Route.useLoaderData()
  return <RootDocument><QueryClientProvider client={queryClient}><PlanProvider value={plan}><TooltipProvider><PlanContent /></TooltipProvider></PlanProvider></QueryClientProvider></RootDocument>
}

function BillingLink({ label }: { label: string }) {
  const { billingUrl } = usePlan()
  return billingUrl ? <a href={billingUrl} className="font-medium underline underline-offset-2">{label}</a> : null
}

function PlanContent() {
  const plan = usePlan(), location = useLocation()
  if (plan.state === 'suspended' && location.pathname !== '/login') return <main className="grid min-h-screen place-items-center bg-app p-6 text-fg"><div className="max-w-md rounded-xl border border-line-strong bg-surface-2 p-8 text-center shadow-card"><h1 className="text-2xl font-semibold">Workspace suspended</h1><p className="mt-3 text-fg-muted">Update billing to restore workspace access.</p>{plan.billingUrl && <p className="mt-5"><BillingLink label="Update billing" /></p>}</div></main>
  return <>{plan.state === 'past_due' && <div role="status" className="border-b border-waiting/30 bg-waiting/10 px-4 py-2 text-center text-sm text-fg">Payment is past due. Your workspace keeps working.{plan.billingUrl && <> · <BillingLink label="Update billing" /></>}</div>}<Outlet /></>
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  useTheme()
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])
  return <html data-theme="dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /><HeadContent /></head><body data-hydrated={hydrated}>{children}<Scripts /></body></html>
}
