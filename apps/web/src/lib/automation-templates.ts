import type { AutomationInput } from '@openstaff/shared'

export interface AutomationTemplate {
  id: string
  title: string
  description: string
  trigger: AutomationInput['trigger']
  cron?: string
  prompt: string
  overlap: AutomationInput['overlap']
}

export const automationTemplates: AutomationTemplate[] = [
  { id: 'daily-standup', title: 'Daily standup', description: 'Summarize weekdays at 09:00.', trigger: 'schedule', cron: '0 9 * * 1-5', prompt: 'Post a short standup: what happened in this room yesterday, open tasks, blockers', overlap: 'skip' },
  { id: 'weekly-digest', title: 'Weekly digest', description: 'Recap the room every Monday.', trigger: 'schedule', cron: '0 9 * * 1', prompt: 'Post a weekly digest of decisions, progress, open tasks, and blockers from this room', overlap: 'skip' },
  { id: 'nightly-checks', title: 'Nightly checks', description: 'Check the workspace at 02:00.', trigger: 'schedule', cron: '0 2 * * *', prompt: 'Check the workspace and tasks, then report any anomalies', overlap: 'skip' },
  { id: 'inbox-triage', title: 'Inbox triage', description: 'Turn incoming payloads into next steps.', trigger: 'webhook', prompt: 'Triage the payload, summarize it, and propose next steps', overlap: 'queue' },
  { id: 'deploy-watch', title: 'Deploy watch', description: 'Watch deploy events for failures.', trigger: 'webhook', prompt: 'Read the deploy event, verify its status, and alert on failure', overlap: 'queue' },
]
