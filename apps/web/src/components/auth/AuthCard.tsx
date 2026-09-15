import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export const authInputClass = 'w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none focus:border-zinc-500'
export const authButtonClass = 'w-full rounded-xl bg-black py-3 font-medium text-white disabled:opacity-50'

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-[#f5f5f3] p-6"><div className="w-full max-w-sm rounded-3xl border border-zinc-200 bg-white p-8"><Link to="/" className="mb-7 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-black text-lg font-semibold text-white">O</span><span><strong className="block text-xl">OpenStaff</strong><span className="text-sm text-zinc-500">Your always-on teammates</span></span></Link><h1 className="text-xl font-semibold">{title}</h1>{subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}<div className="mt-6">{children}</div></div></main>
}

export function AuthError({ message }: { message: string }) {
  return message ? <p role="alert" className="text-sm text-red-600">{message}</p> : null
}
