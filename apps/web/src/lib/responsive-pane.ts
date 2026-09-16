interface ResponsivePaneOptions {
  wide: boolean
  stored: string | null
  defaultOpen: boolean
  requested?: boolean
}

export function responsivePaneOpen({ wide, stored, defaultOpen, requested = false }: ResponsivePaneOptions): boolean {
  if (requested) return true
  if (!wide) return false
  return stored === null ? defaultOpen : stored === 'true'
}
