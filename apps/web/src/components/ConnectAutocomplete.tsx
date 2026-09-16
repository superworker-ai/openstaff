import { appSlug, type ConnectedApp } from '@openstaff/shared'

export function ConnectAutocomplete({ text, apps, onSelect }: { text: string; apps: ConnectedApp[]; onSelect: (app: string) => void }) {
  if (!/^\/connect\s/i.test(text)) return null
  const search = text.replace(/^\/connect\s+/i, '').trim().toLowerCase()
  const matches = apps.filter((app) => !search || app.appName.toLowerCase().includes(search) || app.slug.includes(appSlug(search)))
  return <div role="listbox" aria-label="Connect an app" className="mx-auto mb-2 max-h-52 max-w-[760px] overflow-y-auto rounded-lg border border-line-strong bg-surface-2 p-1 shadow-popover">{matches.map((app) => <button type="button" role="option" aria-selected={false} key={app.slug} onClick={() => onSelect(app.slug)} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-fg hover:bg-surface-3 focus:bg-surface-3"><span className="min-w-0 truncate">{app.appName}</span><span className={`shrink-0 ${app.status === 'connected' ? 'text-xs text-ok' : 'text-xs text-fg-muted'}`}>{app.status}</span></button>)}{!matches.length && <p className="px-3 py-2 text-sm text-fg-muted">No matching apps</p>}</div>
}
