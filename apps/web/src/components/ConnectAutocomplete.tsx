import { appSlug, type ConnectedApp } from '@openstaff/shared'

export function ConnectAutocomplete({ text, apps, onSelect }: { text: string; apps: ConnectedApp[]; onSelect: (app: string) => void }) {
  if (!/^\/connect\s/i.test(text)) return null
  const search = text.replace(/^\/connect\s+/i, '').trim().toLowerCase()
  const matches = apps.filter((app) => !search || app.appName.toLowerCase().includes(search) || app.slug.includes(appSlug(search)))
  return <div role="listbox" aria-label="Connect an app" className="mx-auto mb-2 max-h-52 max-w-3xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">{matches.map((app) => <button type="button" role="option" aria-selected={false} key={app.slug} onClick={() => onSelect(app.slug)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 focus:bg-zinc-100"><span>{app.appName}</span><span className={app.status === 'connected' ? 'text-xs text-emerald-700' : 'text-xs text-zinc-400'}>{app.status}</span></button>)}{!matches.length && <p className="px-3 py-2 text-sm text-zinc-500">No matching apps</p>}</div>
}
