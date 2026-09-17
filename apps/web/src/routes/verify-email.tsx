import { createFileRoute, Link } from '@tanstack/react-router'
import { AuthCard } from '../components/auth/AuthCard'

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>): { error?: string } => ({ error: typeof search.error === 'string' ? search.error : undefined }),
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { error } = Route.useSearch()
  return <AuthCard title={error ? 'Verification failed' : 'Email verified'} subtitle={error ? 'This verification link is invalid or expired.' : 'Your email address is ready to use.'}><Link to="/login" className="block text-sm font-medium underline underline-offset-2">Continue to login</Link></AuthCard>
}
