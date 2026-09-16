import type { ReactNode } from 'react'

export function FeedSection({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return <section className="mt-7" aria-labelledby={`home-${title.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="mb-3 flex min-h-5 items-center gap-2">
      <h2 id={`home-${title.toLowerCase().replaceAll(' ', '-')}`} className="text-[13px] font-semibold text-fg">{title}</h2>
      {count !== undefined && <span className="text-xs text-fg-subtle">{count}</span>}
      {action && <div className="ml-auto text-xs text-fg-muted hover:text-fg">{action}</div>}
    </div>
    {children}
  </section>
}
