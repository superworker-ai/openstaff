import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '../lib/api'
import { useConnectionUpdates } from '../hooks/useConnectedApps'

export function FirstRunChecklist() {
  useConnectionUpdates()
  const { data } = useQuery({ queryKey: ['onboarding'], queryFn: () => api<{ model: boolean; connected: boolean; hasBots: boolean; complete: boolean }>('/api/workspace/onboarding') })
  if (!data || data.complete) return null
  return <nav aria-label="First-run checklist" className="mb-7 flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600"><Link to="/settings">Add a model key {data.model ? '✓' : '✗'}</Link><span>·</span><Link to="/marketplace">Connect an app {data.connected ? '✓' : '✗'}</Link><span>·</span><a href="#create-teammate">Create your first teammate {data.hasBots ? '✓' : '✗'}</a></nav>
}
