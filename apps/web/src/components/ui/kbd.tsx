import type { ReactNode } from 'react'

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] leading-none text-fg-muted">{children}</kbd>
}
