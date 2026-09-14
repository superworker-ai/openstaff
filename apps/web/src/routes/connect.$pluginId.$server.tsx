import { createFileRoute, redirect } from '@tanstack/react-router'
import { loadMe } from '../lib/loaders'
import { ConnectDialog } from '../components/ConnectDialog'

export const Route = createFileRoute('/connect/$pluginId/$server')({
  validateSearch: (search: Record<string, unknown>): { approval?: string; connected?: string; error?: string } => ({ approval: typeof search.approval === 'string' ? search.approval : undefined, connected: typeof search.connected === 'string' ? search.connected : undefined, error: typeof search.error === 'string' ? search.error : undefined }),
  loader: async () => { try { return await loadMe() } catch { throw redirect({ to: '/login' }) } },
  component: ConnectPage,
})
function ConnectPage() {
  const { pluginId, server } = Route.useParams(), { approval } = Route.useSearch()
  return <ConnectDialog pluginId={pluginId} serverName={server} approvalId={approval} standalone />
}
