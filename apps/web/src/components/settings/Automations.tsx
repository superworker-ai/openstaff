import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RoomView } from '../../lib/loaders'
import { api } from '../../lib/api'
import { AutomationRow, type AutomationView } from '../automations/AutomationList'
import { Section } from './common'

export function Automations() {
  const queryClient = useQueryClient(), key = ['automations']
  const query = useQuery({ queryKey: key, queryFn: async () => {
    const [automationData, roomData] = await Promise.all([api<{ automations: AutomationView[] }>('/api/automations'), api<{ rooms: RoomView[] }>('/api/rooms')])
    return { automations: automationData.automations, rooms: roomData.rooms }
  }, refetchInterval: 30_000 })
  const changed = async () => { await queryClient.invalidateQueries({ queryKey: key }) }
  const groups = (query.data?.rooms ?? []).map((room) => ({ room, automations: query.data?.automations.filter((automation) => automation.roomId === room.id) ?? [] })).filter((group) => group.automations.length)
  return <Section title="Automations">{query.data?.automations.length === 0 && <p className="text-sm text-zinc-500">Create automations from a room's settings, or ask a bot to schedule recurring work.</p>}<div className="space-y-5">{groups.map(({ room, automations }) => <div key={room.id}><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">{room.name ?? room.members.find((member) => member.memberKind === 'bot')?.entity?.name ?? 'Room'}</h3>{automations.map((automation) => <AutomationRow key={automation.id} automation={automation} onChanged={changed} />)}</div>)}</div>{query.error && <p role="alert" className="mt-3 text-sm text-red-600">{query.error.message}</p>}</Section>
}
