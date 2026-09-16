import { useState, type ReactNode } from 'react'
export const inputClass = 'mt-2 w-full rounded-md border border-line-strong bg-surface-3 px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-fg'
export const buttonClass = 'rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40'
export const secondaryButtonClass = 'rounded-md border border-line-strong bg-transparent px-4 py-2 text-sm text-fg hover:bg-surface-3 disabled:opacity-40'
export const dangerButtonClass = 'rounded-md border border-danger/50 bg-transparent px-4 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-40'
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-lg border border-line bg-surface-2 p-6 text-fg shadow-card"><h2 className="mb-5 text-lg font-semibold">{title}</h2>{children}</section>
}
export function useAction() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed') } finally { setBusy(false) }
  }
  return { run, busy, error }
}
export function ErrorText({ error }: { error?: string }) { return error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null }
