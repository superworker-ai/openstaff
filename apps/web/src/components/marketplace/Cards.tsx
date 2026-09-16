import type { MarketplaceApp, MarketplaceSkill } from '@openstaff/shared'
import { ComposioConnect } from '../ComposioConnect'
import { buttonClass } from '../settings/common'

export function AppCard({ item, configured, disabled, onPlugin, onConfigured }: { item: MarketplaceApp; configured: boolean; disabled: boolean; onPlugin: (name: string, id?: string) => void; onConfigured: () => void }) {
  return <article data-testid="marketplace-card" className="flex flex-col rounded-lg border border-line bg-surface-2 p-5 shadow-card">
    {item.logo ? <img src={item.logo} alt="" className="mb-4 h-10 w-10 rounded-md object-contain" /> : <div className="mb-4 grid h-10 w-10 place-items-center rounded-md bg-surface-3 text-lg font-semibold">{item.name[0]}</div>}
    <h2 className="font-semibold">{item.name}</h2>
    <p className="mt-2 line-clamp-2 min-h-10 text-sm text-fg-muted">{item.description}</p>
    <span className={`mt-4 self-start rounded-full px-2 py-1 text-xs ${item.status === 'Connected' ? 'bg-ok/10 text-ok' : 'bg-surface-3 text-fg-muted'}`}>{item.status}</span>
    <div className="mt-5 flex flex-1 flex-col items-start justify-end gap-3">
      <ComposioConnect toolkit={item.toolkit} configured={configured} onConfigured={onConfigured} />
      {item.plugins.map((plugin) => <button key={plugin.name} disabled={disabled} className="text-sm underline underline-offset-4" onClick={() => onPlugin(plugin.name, plugin.id)}>{plugin.id ? 'Connect plugin' : 'Install plugin'}</button>)}
    </div>
  </article>
}

export function SkillCard({ item, disabled, install }: { item: MarketplaceSkill; disabled: boolean; install: () => void }) {
  return <article data-testid="marketplace-card" className="rounded-lg border border-line bg-surface-2 p-5 shadow-card">
    <h2 className="font-semibold">{item.manifest?.displayName ?? item.name}</h2>
    <p className="mt-2 text-sm text-fg-muted">{item.manifest?.description ?? item.description}</p>
    <button disabled={item.installed || disabled} className={`${buttonClass} mt-5`} onClick={install}>{item.installed ? 'Installed' : 'Install'}</button>
  </article>
}
