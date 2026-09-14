import { useState, type ReactNode } from 'react'
export const inputClass = 'mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-zinc-500'
export const buttonClass = 'rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-40'
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-zinc-200 bg-white p-6"><h2 className="mb-5 text-lg font-semibold">{title}</h2>{children}</section>
}
export function useAction() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed') } finally { setBusy(false) }
  }
  return { run, busy, error }
}
export function ErrorText({ error }: { error?: string }) { return error ? <p role="alert" className="mt-3 text-sm text-red-600">{error}</p> : null }
