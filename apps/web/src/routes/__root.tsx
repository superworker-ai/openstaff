import { useEffect, useState, type ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, useLocation } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import type { RouterContext } from '../router'
import '../styles.css'
import { loadPlan } from '../lib/loaders'
import { PlanProvider, usePlan } from '../hooks/usePlan'

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: () => loadPlan(),
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
  const plan = Route.useLoaderData()
  return <RootDocument><QueryClientProvider client={queryClient}><PlanProvider value={plan}><PlanContent /></PlanProvider></QueryClientProvider></RootDocument>
}

function BillingLink({ label }: { label: string }) {
  const { billingUrl } = usePlan()
  return billingUrl ? <a href={billingUrl} className="font-medium underline underline-offset-2">{label}</a> : null
}

function PlanContent() {
  const plan = usePlan(), location = useLocation()
  if (plan.state === 'suspended' && location.pathname !== '/login') return <main className="grid min-h-screen place-items-center bg-[#f5f5f3] p-6"><div className="max-w-md rounded-3xl border border-zinc-200 bg-white p-8 text-center"><h1 className="text-2xl font-semibold">Workspace suspended</h1><p className="mt-3 text-zinc-500">Update billing to restore workspace access.</p>{plan.billingUrl && <p className="mt-5"><BillingLink label="Update billing" /></p>}</div></main>
  return <>{plan.state === 'past_due' && <div role="status" className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">Payment is past due. Your workspace keeps working.{plan.billingUrl && <> · <BillingLink label="Update billing" /></>}</div>}<Outlet /></>
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])
  return <html><head><HeadContent /></head><body data-hydrated={hydrated}>{children}<Scripts /></body></html>
}
