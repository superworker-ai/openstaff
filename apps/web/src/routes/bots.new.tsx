import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'
import { AgentDocumentBuilder } from '../components/agent-builder/AgentDocumentBuilder'
import { loadAppShell, loadBotTemplates, loadMe } from '../lib/loaders'

export const Route = createFileRoute('/bots/new')({
  loader: async () => {
    try {
      const [me, templates, shell] = await Promise.all([loadMe(), loadBotTemplates(), loadAppShell()])
      return { ...me, ...templates, ...shell }
    } catch { throw redirect({ to: '/login' }) }
  },
  component: NewBotPage,
})

function NewBotPage() {
  const { templates, user, rooms, bots, users } = Route.useLoaderData()
  return <AppShell rooms={rooms} currentUser={user} bots={bots} users={users}>
    <AgentDocumentBuilder key={user.id} templates={templates} userId={user.id} />
  </AppShell>
}
