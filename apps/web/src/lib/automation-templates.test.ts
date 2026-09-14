import { describe, expect, it } from 'vitest'
import { AUTOMATION_TRIGGERS } from '@openstaff/shared'
import { automationTemplates } from './automation-templates'

describe('automation templates', () => {
  it('has unique ids and valid complete trigger data', () => {
    expect(new Set(automationTemplates.map((template) => template.id)).size).toBe(automationTemplates.length)
    for (const template of automationTemplates) {
      expect(template.prompt.trim()).not.toBe('')
      expect(AUTOMATION_TRIGGERS).toContain(template.trigger)
      expect(Boolean(template.cron)).toBe(template.trigger === 'schedule')
    }
  })
})
