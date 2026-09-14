import { useState } from 'react'
import type { RoomView } from '../lib/loaders'
import { api } from '../lib/api'
import { AutomationList } from './automations/AutomationList'

export function RoomSettings({ room, onClose, onChanged }: { room: RoomView; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(room.name ?? '')
  const [section, setSection] = useState(room.section ?? '')
  const save = async () => { await api(`/api/rooms/${room.id}`, { method: 'PATCH', body: JSON.stringify({ name: room.kind === 'dm' ? null : name, section: section || null }) }); onChanged(); onClose() }
  const remove = async (kind: string, id: string) => { await api(`/api/rooms/${room.id}/members/${kind}/${id}`, { method: 'DELETE' }); onChanged() }
  return <div className="fixed inset-0 z-40 grid place-items-center bg-black/25 p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-xl"><div className="flex shrink-0 justify-between p-6 pb-4"><h2 className="text-lg font-semibold">Room settings</h2><button onClick={onClose} className="text-zinc-500">Close</button></div><div className="min-h-0 overflow-y-auto px-6 pb-6">{room.kind === 'group' && <label className="mb-4 block text-xs font-medium text-zinc-500">Name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-zinc-900" /></label>}<label className="mb-5 block text-xs font-medium text-zinc-500">Section<input value={section} onChange={(event) => setSection(event.target.value)} placeholder="Unassigned" className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-zinc-900" /></label><h3 className="mb-2 text-xs font-medium text-zinc-500">Members</h3><div className="mb-5 space-y-2">{room.members.map((member) => <div key={`${member.memberKind}-${member.memberId}`} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2"><span>{member.entity?.name ?? member.memberId}</span><button onClick={() => remove(member.memberKind, member.memberId)} className="text-xs text-red-600">Remove</button></div>)}</div><AutomationList room={room} /><button onClick={save} className="mt-6 w-full rounded-xl bg-black py-2.5 text-white">Save room</button></div></div></div>
}
