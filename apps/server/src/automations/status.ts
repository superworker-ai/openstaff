import type { AutomationRunStatus, InvocationStatus } from '@openstaff/shared'

export function deriveInvocationStatus(runs: Array<{ status: AutomationRunStatus }>): InvocationStatus {
  if (!runs.length || runs.every((run) => run.status === 'skipped')) return 'skipped'
  if (runs.some((run) => ['queued', 'running', 'waiting_approval'].includes(run.status))) return 'running'
  const nonSkipped = runs.filter((run) => run.status !== 'skipped')
  if (nonSkipped.length && nonSkipped.every((run) => run.status === 'failed')) return 'failed'
  if (nonSkipped.some((run) => run.status === 'failed')) return 'partial_failed'
  return 'completed'
}
