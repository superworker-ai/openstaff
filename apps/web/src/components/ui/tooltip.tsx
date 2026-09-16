import type { ReactNode } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { Kbd } from './kbd'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={100}>{children}</TooltipPrimitive.Provider>
}

export function Tooltip({ label, kbd, children }: { label: string; kbd?: string; children: ReactNode }) {
  return <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content sideOffset={8} className="ui-overlay-content z-[100] flex origin-[var(--radix-tooltip-content-transform-origin)] items-center gap-2 rounded-md border border-line-strong bg-surface-4 px-2.5 py-1.5 text-xs text-fg shadow-popover" aria-label={label}>
        {label}{kbd && <Kbd>{kbd}</Kbd>}
        <TooltipPrimitive.Arrow className="fill-surface-4" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
}
