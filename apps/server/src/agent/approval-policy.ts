export type ApprovalPolicy = 'auto' | 'writes' | 'all'

const WRITE_TOOLS = new Set([
  'shell', 'write_file', 'edit_file', 'browser_click', 'browser_type',
  'computer_click', 'computer_double_click', 'computer_right_click', 'computer_drag',
  'computer_type', 'computer_key', 'computer_scroll', 'computer_focus_window',
])

export function toolApprovalFor(policy: ApprovalPolicy, mcpReadOnly = new Set<string>(), composioReadOnly?: (slug: string) => Promise<boolean>, connectionRequired?: (toolCall: { toolName: string; input?: unknown; toolCallId?: string }) => Promise<string | undefined>) {
  return async ({ toolCall }: { toolCall: { toolName: string; input?: unknown; toolCallId?: string } }): Promise<'user-approval' | { type: 'user-approval'; reason: string } | undefined> => {
    const app = await connectionRequired?.(toolCall)
    if (app) return { type: 'user-approval', reason: `connect:${app}` }
    if (policy === 'all') return 'user-approval'
    if (policy === 'writes' && WRITE_TOOLS.has(toolCall.toolName)) return 'user-approval'
    if (policy === 'writes' && toolCall.toolName.includes('__') && !mcpReadOnly.has(toolCall.toolName)) return 'user-approval'
    if (policy === 'writes' && toolCall.toolName === 'composio_execute') {
      const slug = (toolCall.input as { slug?: string } | undefined)?.slug
      try { if (slug && await composioReadOnly?.(slug)) return undefined } catch { /* Unknown metadata requires approval. */ }
      return 'user-approval'
    }
    return undefined
  }
}
