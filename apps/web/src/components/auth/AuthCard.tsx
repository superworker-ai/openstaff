import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { BrandMark } from '../BrandMark'

export const authInputClass = 'w-full rounded-md border border-line-strong bg-surface-3 px-4 py-3 text-fg outline-none placeholder:text-fg-subtle focus:border-fg'
export const authButtonClass = 'w-full rounded-md bg-accent py-3 font-medium text-accent-fg hover:opacity-90 disabled:opacity-50'

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-app p-6 text-fg"><div className="w-full max-w-sm rounded-xl border border-line-strong bg-surface-2 p-8 shadow-card"><Link to="/" className="mb-7 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center text-fg"><BrandMark size={40} /></span><span><strong className="block text-xl">OpenStaff</strong><span className="text-sm text-fg-muted">Your always-on teammates</span></span></Link><h1 className="text-xl font-semibold">{title}</h1>{subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}<div className="mt-6">{children}</div></div></main>
}

export function AuthError({ message }: { message: string }) {
  return message ? <p role="alert" className="text-sm text-danger">{message}</p> : null
}
