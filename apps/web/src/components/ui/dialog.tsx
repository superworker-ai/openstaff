import type { ComponentPropsWithoutRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description

type ContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  label: string
  overlayClassName?: string
}

export function DialogContent({ label, overlayClassName = '', className = '', children, ...props }: ContentProps) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className={`ui-overlay-backdrop fixed inset-0 z-50 bg-overlay ${overlayClassName}`} />
    <DialogPrimitive.Content aria-label={label} aria-describedby={undefined} className={`ui-dialog-content fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line-strong bg-surface-2 text-fg shadow-popover outline-none ${className}`} {...props}>{children}</DialogPrimitive.Content>
  </DialogPrimitive.Portal>
}
