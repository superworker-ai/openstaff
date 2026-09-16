import { Check } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'
import { useTheme, type ResolvedTheme, type ThemePreference } from '../../lib/theme'
import { Section } from './common'

const options = [
  { id: 'light', label: 'Light', description: 'Notion-style white.' },
  { id: 'dark', label: 'Dark', description: 'Skydive-style black.' },
  { id: 'system', label: 'System', description: 'Follows your OS setting.' },
] as const satisfies ReadonlyArray<{ id: ThemePreference; label: string; description: string }>

const previewColors: Record<ResolvedTheme, { rail: string; sidebar: string; content: string; text: string; muted: string; accent: string; line: string }> = {
  light: { rail: '#f9f8f7', sidebar: '#f9f8f7', content: '#ffffff', text: '#2c2c2b', muted: '#a19e99', accent: '#2383e2', line: 'rgb(42 28 0 / .07)' },
  dark: { rail: '#0d0d0f', sidebar: '#0d0d0f', content: '#141416', text: '#f2f2f3', muted: '#6f6f78', accent: '#f2f2f3', line: 'rgb(255 255 255 / .08)' },
}

function ThemePreview({ theme }: { theme: ResolvedTheme }) {
  const colors = previewColors[theme]
  return <div aria-hidden="true" className="flex h-[72px] w-[120px] shrink-0 overflow-hidden rounded-md border" style={{ borderColor: colors.line, background: colors.content }}>
    <div className="w-4 shrink-0" style={{ background: colors.rail }}><span className="mx-auto mt-2 block h-2 w-2 rounded-sm" style={{ background: colors.accent }} /></div>
    <div className="w-8 shrink-0 border-r px-1 pt-3" style={{ background: colors.sidebar, borderColor: colors.line }}><span className="block h-1 rounded-full" style={{ background: colors.muted }} /><span className="mt-2 block h-1 rounded-full" style={{ background: colors.muted }} /><span className="mt-2 block h-1 rounded-full" style={{ background: colors.muted }} /></div>
    <div className="min-w-0 flex-1 px-2 pt-4" style={{ background: colors.content }}><span className="block h-1.5 w-10 rounded-full" style={{ background: colors.text }} /><span className="mt-2 block h-1 w-12 rounded-full" style={{ background: colors.muted }} /><span className="mt-3 block h-2.5 w-6 rounded-full" style={{ background: colors.accent }} /></div>
  </div>
}

export function Appearance() {
  const { preference, resolved, setPreference } = useTheme()
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!direction) return
    event.preventDefault()
    const nextIndex = (index + direction + options.length) % options.length
    const next = options[nextIndex]!
    setPreference(next.id)
    optionRefs.current[nextIndex]?.focus()
  }

  return <Section title="Appearance">
    <h3 className="font-medium">Theme</h3>
    <p className="mt-1 text-sm text-fg-muted">Choose how OpenStaff looks on this device.</p>
    <div role="radiogroup" aria-label="Theme" className="mt-5 grid gap-3 sm:grid-cols-3">
      {options.map((option, index) => {
        const selected = preference === option.id
        const previewTheme = option.id === 'system' ? resolved : option.id
        return <button
          key={option.id}
          ref={(node) => { optionRefs.current[index] = node }}
          type="button"
          role="radio"
          aria-checked={selected}
          tabIndex={selected ? 0 : -1}
          data-testid={`theme-option-${option.id}`}
          onClick={() => setPreference(option.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={`relative flex min-w-0 flex-col items-start rounded-lg border bg-surface-2 p-3 text-left shadow-card ${selected ? 'border-accent ring-2 ring-accent/20' : 'border-line-strong hover:bg-surface-3'}`}
        >
          {selected && <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-fg"><Check aria-hidden="true" size={13} strokeWidth={3} /></span>}
          <ThemePreview theme={previewTheme} />
          <span className="mt-3 font-medium text-fg">{option.label}</span>
          <span className="mt-1 text-xs text-fg-muted">{option.description}</span>
          {option.id === 'system' && <span className="mt-1 text-[11px] text-fg-subtle">Currently {resolved}</span>}
        </button>
      })}
    </div>
  </Section>
}
