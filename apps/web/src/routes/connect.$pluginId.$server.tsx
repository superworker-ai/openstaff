import { createFileRoute, redirect } from '@tanstack/react-router'
import { loadMe } from '../lib/loaders'
import { ConnectDialog } from '../components/ConnectDialog'
import { authRedirect } from '../lib/api-error'

export const Route = createFileRoute('/connect/$pluginId/$server')({
  validateSearch: (search: Record<string, unknown>): { approval?: string; connected?: string; error?: string } => ({ approval: typeof search.approval === 'string' ? search.approval : undefined, connected: typeof search.connected === 'string' ? search.connected : undefined, error: typeof search.error === 'string' ? search.error : undefined }),
  loader: async () => { try { return await loadMe() } catch (reason) { throw redirect({ to: authRedirect(reason) }) } },
  component: ConnectPage,
})
function ConnectPage() {
  const { pluginId, server } = Route.useParams(), { approval, error } = Route.useSearch()
  return <ConnectDialog pluginId={pluginId} serverName={server} approvalId={approval} initialError={error} standalone />
}
