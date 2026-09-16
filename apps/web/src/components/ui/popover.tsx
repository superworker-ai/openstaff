import type { ComponentPropsWithoutRef } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor
export const PopoverClose = PopoverPrimitive.Close

type ContentProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & { label: string; portalled?: boolean }

export function PopoverContent({ label, portalled = true, className = '', sideOffset = 8, ...props }: ContentProps) {
  const content = <PopoverPrimitive.Content aria-label={label} sideOffset={sideOffset} className={`ui-overlay-content z-50 origin-[var(--radix-popover-content-transform-origin)] rounded-lg border border-line-strong bg-surface-2 text-fg shadow-popover outline-none ${className}`} {...props} />
  return portalled ? <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal> : content
}
