import { expect, it } from 'vitest'
import { toolApprovalFor } from './approval-policy.js'

it('classifies desktop input and focus as writes while observations stay read-only', async () => {
  for (const toolName of ['computer_click', 'computer_double_click', 'computer_right_click', 'computer_drag', 'computer_type', 'computer_key', 'computer_scroll', 'computer_focus_window']) {
    expect(await toolApprovalFor('writes')({ toolCall: { toolName } })).toBe('user-approval')
  }
  for (const toolName of ['computer_screenshot', 'computer_move', 'computer_wait', 'computer_windows']) {
    expect(await toolApprovalFor('writes')({ toolCall: { toolName } })).toBeUndefined()
  }
})
