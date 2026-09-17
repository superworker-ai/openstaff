import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { AuthCard } from '../components/auth/AuthCard'
import { TwoFactorEnrollment } from '../components/auth/TwoFactorEnrollment'
import { loadMe } from '../lib/loaders'

export const Route = createFileRoute('/two-factor/setup')({
  loader: async () => { try { return await loadMe() } catch { throw redirect({ to: '/login' }) } },
  component: RequiredTwoFactorSetup,
})

function RequiredTwoFactorSetup() {
  const navigate = useNavigate(), { user } = Route.useLoaderData()
  if (user.twoFactorEnabled) { void navigate({ to: '/' }); return null }
  return <AuthCard title="Protect your account" subtitle="Your workspace requires two-factor authentication"><TwoFactorEnrollment onComplete={() => navigate({ to: '/' })} /></AuthCard>
}
