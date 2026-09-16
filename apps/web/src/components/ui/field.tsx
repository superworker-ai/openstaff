import type { ReactNode } from 'react'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-xs font-medium text-fg-muted">{label}<div className="mt-1 [&>*]:w-full [&>*]:rounded-md [&>*]:border [&>*]:border-line-strong [&>*]:bg-surface-3 [&>*]:px-3 [&>*]:py-2.5 [&>*]:text-fg [&>*]:outline-none [&>*]:placeholder:text-fg-subtle [&>*]:focus:border-fg">{children}</div></label>
}
