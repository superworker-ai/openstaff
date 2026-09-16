import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { BrandMark } from './BrandMark'

const backClass = 'rounded-md px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg'

export function PageFrame({ children, backLabel, backTo, onBack, actions }: { children: ReactNode; backLabel: string; backTo?: '/'; onBack?: () => void; actions?: ReactNode }) {
  return <main className="min-h-screen bg-app text-fg">
    <header className="h-14 border-b border-line bg-surface">
      <div className="mx-auto flex h-full max-w-5xl items-center gap-3 px-6">
        {onBack ? <button type="button" onClick={onBack} className={backClass}>{backLabel}</button> : <Link to={backTo ?? '/'} className={backClass}>{backLabel}</Link>}
        <div className="flex-1" />
        {actions}
        <span className="grid h-8 w-8 place-items-center text-fg"><BrandMark /></span>
      </div>
    </header>
    <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
  </main>
}
