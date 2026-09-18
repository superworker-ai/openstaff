import { render } from '@react-email/render'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { invitationTemplate, magicLinkTemplate, resetPasswordTemplate, verifyEmailTemplate, type EmailContext, type EmailTemplate } from './templates.js'
import { Layout } from './templates/Layout.js'

const url = 'https://app.test/link/TOKEN123'
const hostile = '<script>alert(1)</script>'

const templates: Array<{ name: string; heading: string; label: string; build: (context: EmailContext) => Promise<EmailTemplate> }> = [
  { name: 'verify email', heading: 'Verify your email', label: 'Verify email', build: (context) => verifyEmailTemplate(url, context) },
  { name: 'reset password', heading: 'Reset your password', label: 'Reset password', build: (context) => resetPasswordTemplate(url, context) },
  { name: 'magic link', heading: 'Your sign-in link', label: 'Sign in', build: (context) => magicLinkTemplate(url, context) },
  { name: 'invitation', heading: 'invited to Acme', label: 'Accept invitation', build: (context) => invitationTemplate(context.workspaceName ?? 'Acme', 'admin', url, context) },
]

describe('email templates', () => {
  for (const { name, heading, label, build } of templates) {
    it(`${name} renders a branded HTML part`, async () => {
      const { html } = await build({ workspaceName: 'Acme', appUrl: 'https://app.test', inviterName: 'Dana' })
      expect(html).toContain(heading)
      expect(html).toContain(label)
      expect(html).toContain(`href="${url}"`)
      expect(html).toContain('OpenStaff')
    })

    it(`${name} escapes a hostile workspace name`, async () => {
      const { html } = await build({ workspaceName: hostile, appUrl: 'https://app.test' })
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain(hostile)
    })

    it(`${name} renders a plain text part with the link and no markup`, async () => {
      const { text } = await build({ workspaceName: 'Acme', appUrl: 'https://app.test', inviterName: 'Dana' })
      expect(text).toContain(url)
      expect(text).not.toMatch(/<\/?[a-z]/i)
    })
  }

  it('keeps the subjects the callers already send', async () => {
    expect((await verifyEmailTemplate(url)).subject).toBe('Verify your OpenStaff email')
    expect((await resetPasswordTemplate(url)).subject).toBe('Reset your OpenStaff password')
    expect((await magicLinkTemplate(url)).subject).toBe('Your OpenStaff sign-in link')
    expect((await invitationTemplate('Acme', 'member', url)).subject).toBe('Join Acme on OpenStaff')
  })

  it('names the inviter and the role in the invitation', async () => {
    const { text } = await invitationTemplate('Acme', 'member', url, { inviterName: 'Dana' })
    expect(text).toContain('Dana invited you to join Acme as a member.')
    const anonymous = await invitationTemplate('Acme', 'admin', url)
    expect(anonymous.text).toContain('Someone invited you to join Acme as an administrator.')
  })

  it('footers the workspace and host when known and plain OpenStaff otherwise', async () => {
    const branded = await render(createElement(Layout, { preview: 'p', heading: 'h', workspaceName: 'Acme', appUrl: 'https://app.test/base', children: 'body' }), { plainText: true })
    expect(branded).toContain('Acme on OpenStaff · app.test')
    const bare = await render(createElement(Layout, { preview: 'p', heading: 'h', children: 'body' }), { plainText: true })
    expect(bare.trimEnd().endsWith('OpenStaff')).toBe(true)
    expect(bare).not.toContain('·')
  })
})
