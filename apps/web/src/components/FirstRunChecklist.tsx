import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { HomeOnboarding } from '@openstaff/shared'
import { api } from '../lib/api'
import { useConnectionUpdates } from '../hooks/useConnectedApps'

export function FirstRunChecklist({ initialData }: { initialData?: HomeOnboarding } = {}) {
  useConnectionUpdates()
  const { data } = useQuery({ queryKey: ['onboarding'], queryFn: () => api<HomeOnboarding>('/api/workspace/onboarding'), initialData })
  if (!data || data.complete) return null
  return <nav aria-label="First-run checklist" className="mb-7 flex flex-wrap gap-3 rounded-md border border-line bg-surface-2 p-4 text-sm text-fg-muted"><Link to="/settings" className="hover:text-fg">Add a model key {data.model ? '✓' : '✗'}</Link><span>·</span><Link to="/marketplace" className="hover:text-fg">Connect an app {data.connected ? '✓' : '✗'}</Link><span>·</span><a href="#create-teammate" className="hover:text-fg">Create your first teammate {data.hasBots ? '✓' : '✗'}</a></nav>
}
