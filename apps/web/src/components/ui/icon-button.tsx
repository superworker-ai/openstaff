import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Tooltip } from './tooltip'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string
  kbd?: string
  children: ReactNode
}

export function IconButton({ label, kbd, children, className = '', type = 'button', ...props }: Props) {
  return <Tooltip label={label} kbd={kbd}>
    <button type={type} aria-label={label} className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-md text-fg-muted transition-[color,background-color,transform] duration-150 ease-out hover:bg-surface-3 hover:text-fg active:scale-[.97] aria-pressed:bg-surface-4 aria-pressed:text-fg ${className}`} {...props}>{children}</button>
  </Tooltip>
}
