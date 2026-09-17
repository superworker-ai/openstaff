import { useState } from 'react'
import type { RoomView } from '../lib/loaders'
import { api } from '../lib/api'
import { AutomationList } from './automations/AutomationList'
import { SectionPicker, SectionTriggerLabel } from './RoomSections'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

export function RoomSettings({ room, onClose, onChanged }: { room: RoomView; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(room.name ?? '')
  const save = async () => { await api(`/api/rooms/${room.id}`, { method: 'PATCH', body: JSON.stringify({ name: room.kind === 'dm' ? null : name }) }); onChanged(); onClose() }
  const remove = async (kind: string, id: string) => { await api(`/api/rooms/${room.id}/members/${kind}/${id}`, { method: 'DELETE' }); onChanged() }
  const input = 'mt-1 w-full rounded-md border border-line-strong bg-surface-3 px-3 py-2.5 text-fg outline-none placeholder:text-fg-subtle'
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent label="Room settings" className="room-settings flex !max-h-[90vh] max-w-xl flex-col !overflow-hidden">
      <div className="flex shrink-0 items-center justify-between p-6 pb-4"><DialogTitle className="text-lg font-semibold">Room settings</DialogTitle><button type="button" onClick={onClose} className="text-sm text-fg-muted hover:text-fg">Close</button></div>
      <div className="scrollbar-thin min-h-0 overflow-y-auto px-6 pb-6">
        {room.kind === 'group' && <label className="mb-4 block text-xs font-medium text-fg-muted">Name<input value={name} onChange={(event) => setName(event.target.value)} className={input} /></label>}
        <div className="mb-5">
          <p className="mb-1 text-xs font-medium text-fg-muted">Section</p>
          <SectionPicker roomId={room.id} trigger={<button data-testid="room-settings-section" type="button" className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-line-strong bg-surface-3 px-3 text-left text-sm text-fg transition-[transform,background-color] duration-150 ease-out hover:bg-surface-4 active:scale-[.99]"><SectionTriggerLabel roomId={room.id} /></button>} />
        </div>
        <h3 className="mb-2 text-xs font-medium text-fg-muted">Members</h3>
        <div className="mb-5 space-y-2">{room.members.map((member) => <div key={`${member.memberKind}-${member.memberId}`} className="flex items-center justify-between rounded-md bg-surface-3 px-3 py-2"><span>{member.entity?.name ?? member.memberId}</span><button type="button" onClick={() => void remove(member.memberKind, member.memberId)} className="text-xs text-danger">Remove</button></div>)}</div>
        <AutomationList room={room} />
        <button type="button" onClick={() => void save()} className="mt-6 w-full rounded-md bg-accent py-2.5 font-medium text-accent-fg">Save room</button>
      </div>
    </DialogContent>
  </Dialog>
}
