/** Two-option segmented control: a personal account for one member, or one account every bot shares. */
export function ScopePicker({ value, onChange, disabled }: { value: 'member' | 'workspace'; onChange: (scope: 'member' | 'workspace') => void; disabled?: boolean }) {
  const options = [['member', 'Just me'], ['workspace', 'Everyone']] as const
  return <div role="group" aria-label="Who can use this connection" className="inline-flex rounded-md border border-line bg-surface-3 p-0.5">
    {options.map(([scope, label]) => <button key={scope} type="button" disabled={disabled} aria-pressed={value === scope} onClick={() => onChange(scope)}
      className={`rounded-[5px] px-2.5 py-1 text-xs ${value === scope ? 'bg-surface-2 text-fg shadow-card' : 'text-fg-muted hover:text-fg'} disabled:opacity-40`}>{label}</button>)}
  </div>
}
