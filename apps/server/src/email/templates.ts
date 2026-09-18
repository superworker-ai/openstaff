import { render } from '@react-email/render'
import { createElement, type ReactElement } from 'react'
import { Invitation } from './templates/Invitation.js'
import type { EmailContext } from './templates/Layout.js'
import { MagicLink } from './templates/MagicLink.js'
import { ResetPassword } from './templates/ResetPassword.js'
import { VerifyEmail } from './templates/VerifyEmail.js'

export type { EmailContext }

export interface EmailTemplate {
  subject: string
  text: string
  html: string
}

// The components live in ./templates; this module only builds props and renders both parts.
async function build(subject: string, element: ReactElement): Promise<EmailTemplate> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])
  return { subject, text, html }
}

export async function verifyEmailTemplate(url: string, context: EmailContext = {}): Promise<EmailTemplate> {
  return build('Verify your OpenStaff email', createElement(VerifyEmail, { ...context, url }))
}

export async function resetPasswordTemplate(url: string, context: EmailContext = {}): Promise<EmailTemplate> {
  return build('Reset your OpenStaff password', createElement(ResetPassword, { ...context, url }))
}

export async function magicLinkTemplate(url: string, context: EmailContext = {}): Promise<EmailTemplate> {
  return build('Your OpenStaff sign-in link', createElement(MagicLink, { ...context, url }))
}

export async function invitationTemplate(workspaceName: string, role: 'admin' | 'member', url: string, context: EmailContext = {}): Promise<EmailTemplate> {
  return build(`Join ${workspaceName} on OpenStaff`, createElement(Invitation, { ...context, url, role, workspaceName }))
}
