import type { VariableSchema } from '@openstaff/shared'
import { inputClass } from './common'
type Field = NonNullable<VariableSchema['properties']>[string]
export function VariableInput({ field, value, configured, onChange }: { field: Field; value: unknown; configured: boolean; onChange: (value: unknown) => void }) {
  if (field.enum || field.type === 'boolean') {
    const choices = field.enum ?? [true, false]
    return <select className={inputClass} value={value === undefined ? '' : String(value)} onChange={(e) => onChange(choices.find((item) => String(item) === e.target.value))}><option value="">Keep current value</option>{choices.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select>
  }
  if (field.type === 'object' || field.type === 'array') return <textarea className={inputClass} placeholder={configured ? 'Configured; enter JSON to replace' : 'JSON value'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
  return <input type={['number', 'integer'].includes(field.type ?? '') ? 'number' : 'password'} autoComplete="new-password" className={inputClass} placeholder={configured ? '••••••••' : field.description ?? ''} value={String(value ?? '')} onChange={(e) => onChange(['number', 'integer'].includes(field.type ?? '') ? Number(e.target.value) : e.target.value)} />
}
