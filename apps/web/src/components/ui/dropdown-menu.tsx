import type { ComponentPropsWithoutRef } from 'react'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'

export const DropdownMenu = DropdownPrimitive.Root
export const DropdownMenuTrigger = DropdownPrimitive.Trigger
export const DropdownMenuGroup = DropdownPrimitive.Group
export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup

type ContentProps = ComponentPropsWithoutRef<typeof DropdownPrimitive.Content> & { label: string }

export function DropdownMenuContent({ label, className = '', sideOffset = 8, ...props }: ContentProps) {
  return <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content aria-label={label} sideOffset={sideOffset} className={`ui-overlay-content z-50 min-w-44 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-lg border border-line-strong bg-surface-2 p-1 text-fg shadow-popover outline-none ${className}`} {...props} />
  </DropdownPrimitive.Portal>
}

export function DropdownMenuItem({ className = '', ...props }: ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>) {
  return <DropdownPrimitive.Item className={`flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg ${className}`} {...props} />
}

export function DropdownMenuRadioItem({ className = '', children, ...props }: ComponentPropsWithoutRef<typeof DropdownPrimitive.RadioItem>) {
  return <DropdownPrimitive.RadioItem className={`relative flex cursor-pointer select-none items-center rounded-md py-2 pl-7 pr-2.5 text-sm outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg ${className}`} {...props}>
    <span className="absolute left-2 grid h-3 w-3 place-items-center"><DropdownPrimitive.ItemIndicator><span className="block h-1.5 w-1.5 rounded-full bg-fg" /></DropdownPrimitive.ItemIndicator></span>{children}
  </DropdownPrimitive.RadioItem>
}

export function DropdownMenuLabel({ className = '', ...props }: ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={`px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle ${className}`} {...props} />
}

export function DropdownMenuSeparator({ className = '', ...props }: ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>) {
  return <DropdownPrimitive.Separator className={`my-1 h-px bg-line ${className}`} {...props} />
}
