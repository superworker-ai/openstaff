import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'
import { AgentDocumentBuilder } from '../components/agent-builder/AgentDocumentBuilder'
import { loadAppShell, loadBot, loadBotTemplates, loadMe } from '../lib/loaders'

export const Route = createFileRoute('/bots/$botId')({
  loader: async ({ params }) => {
    try {
      const [me, templates, shell, result] = await Promise.all([
        loadMe(),
        loadBotTemplates(),
        loadAppShell(),
        loadBot({ data: { botId: params.botId } }),
      ])
      return { ...me, ...templates, ...shell, ...result }
    } catch {
      throw redirect({ to: '/login' })
    }
  },
  component: EditBotPage,
})

function EditBotPage() {
  const { bot, templates, user, rooms, bots, users } = Route.useLoaderData()
  const currentRoom = rooms.find((room) => room.kind === 'dm'
    && room.members.some((member) => member.memberKind === 'bot' && member.memberId === bot.id))

  return <AppShell rooms={rooms} currentRoomId={currentRoom?.id} currentUser={user} bots={bots} users={users}>
    <AgentDocumentBuilder
      key={`${user.id}:${bot.id}`}
      mode="edit"
      templates={templates}
      userId={user.id}
      bot={bot}
      rooms={rooms}
    />
  </AppShell>
}
