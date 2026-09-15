import { createFileRoute, redirect } from '@tanstack/react-router'
import { appName } from '@openstaff/shared'
import { loadMe } from '../lib/loaders'
import { useConnectedApps } from '../hooks/useConnectedApps'
import { ComposioConnect } from '../components/ComposioConnect'
import { authRedirect } from '../lib/api-error'

export const Route = createFileRoute('/connect/composio')({
  validateSearch: (search: Record<string, unknown>) => ({ toolkit: typeof search.toolkit === 'string' ? search.toolkit : 'gmail', approval: typeof search.approval === 'string' ? search.approval : undefined }),
  loader: async () => { try { return await loadMe() } catch (reason) { throw redirect({ to: authRedirect(reason) }) } },
  component: ConnectComposioPage,
})
function ConnectComposioPage() {
  const { toolkit, approval } = Route.useSearch(), apps = useConnectedApps()
  return <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-6"><section className="w-full max-w-md space-y-5 rounded-2xl border border-zinc-200 bg-white p-6"><h1 className="text-xl font-semibold">Connect {appName(toolkit)}</h1><p className="text-sm text-zinc-500">Sign in to continue your conversation.</p>{apps.data && <ComposioConnect toolkit={toolkit} approvalId={approval} configured={apps.data.configured} standalone />}</section></main>
}
