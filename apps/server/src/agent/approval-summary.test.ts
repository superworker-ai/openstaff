import { expect, it } from 'vitest'
import { messagePreview } from '@openstaff/shared'
import { approvalSummary } from './approval-summary.js'

it('summarizes approval inputs without exposing raw JSON in the preview', () => {
  expect(approvalSummary('write_file', { path: 'notes/hello.txt', content: 'Hello, world!' })).toBe('Write notes/hello.txt (13 bytes)')
  expect(approvalSummary('edit_file', { path: 'a' })).toBe('Edit a')
  expect(approvalSummary('shell', { command: 'pwd' })).toBe('Run: pwd')
  expect(approvalSummary('browser_click', { ref: 'e1' })).toBe('Click e1')
  expect(approvalSummary('browser_type', { ref: 'e2' })).toBe('Type into e2')
  expect(approvalSummary('computer_click', { x: 412, y: 300 })).toBe('Click at 412,300')
  expect(approvalSummary('computer_type', { text: 'hello' })).toBe('Type "hello"')
  expect(approvalSummary('computer_key', { key: 'ctrl+l' })).toBe('Press ctrl+l')
  expect(approvalSummary('composio_execute', { slug: 'GMAIL_SEND_EMAIL' })).toBe('GMAIL_SEND_EMAIL in gmail')
  expect(approvalSummary('xero__invoice', {})).toBe('xero: invoice')
  expect(messagePreview({ authorKind: 'system', text: 'Write a', attachments: [{ subtype: 'approval', botName: 'drake' }] })).toBe('drake needs approval')
  expect(messagePreview({ authorKind: 'system', text: 'hello', attachments: [] })).toBe('hello')
})
