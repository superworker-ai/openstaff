import { Link } from '@tanstack/react-router'
import { Check, FileText, X } from 'lucide-react'
import type { HomeDoneItem } from '@openstaff/shared'
import { relativeTime } from '../../lib/time'

function fileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${Math.ceil(size / 1024)} KB`
  return `${(size / 1024 ** 2).toFixed(1)} MB`
}

export function DoneRow({ item }: { item: HomeDoneItem }) {
  const failed = item.status === 'failed'
  return <article className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 px-2 py-3">
    <span aria-hidden="true" className={`grid h-7 w-7 place-items-center rounded-lg text-white ${failed ? 'bg-danger' : 'bg-ok'}`}>{failed ? <X size={15} /> : <Check size={16} />}</span>
    <div className="min-w-0">
      <h3 className="text-[13px] text-fg"><b>{item.botName}</b>{item.roomName !== item.botName && <> · {item.roomName}</>}</h3>
      <p className={`mt-0.5 line-clamp-2 text-xs ${failed ? 'text-danger' : 'text-fg-muted'}`}>{item.summary || (failed ? 'Task failed' : 'Finished')}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">{item.attachments.map((file) => <span key={`${file.path}:${file.name}`} title={file.path} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted"><FileText size={11} />{file.name} · {fileSize(file.size)}</span>)}<time className="text-[11px] text-fg-subtle">{relativeTime(item.finishedAt)}</time></div>
    </div>
    <Link to="/rooms/$roomId" params={{ roomId: item.roomId }} className="mt-0.5 rounded-md border border-line-strong px-3 py-1.5 text-xs text-fg hover:bg-surface-3">Open</Link>
  </article>
}
