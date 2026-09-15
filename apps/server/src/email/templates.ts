export interface EmailTemplate {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function linkTemplate(subject: string, introduction: string, url: string, action: string, expiry: string): EmailTemplate {
  const safeUrl = escapeHtml(url), safeIntroduction = escapeHtml(introduction)
  return {
    subject,
    text: `${introduction}\n\n${url}\n\n${expiry}`,
    html: `<p>${safeIntroduction}</p><p><a href="${safeUrl}">${escapeHtml(action)}</a></p><p>${escapeHtml(expiry)}</p>`,
  }
}

export function verifyEmailTemplate(url: string): EmailTemplate {
  return linkTemplate('Verify your OpenStaff email', 'Verify your email address to finish signing in to OpenStaff.', url, 'Verify email', 'This link expires in one hour.')
}

export function resetPasswordTemplate(url: string): EmailTemplate {
  return linkTemplate('Reset your OpenStaff password', 'Use this link to choose a new OpenStaff password.', url, 'Reset password', 'This link expires in one hour. Ignore this email if you did not request it.')
}

export function magicLinkTemplate(url: string): EmailTemplate {
  return linkTemplate('Your OpenStaff sign-in link', 'Use this secure link to sign in to OpenStaff.', url, 'Sign in', 'This link expires in five minutes and can be used once.')
}

export function invitationTemplate(workspaceName: string, role: 'admin' | 'member', url: string): EmailTemplate {
  return linkTemplate(`Join ${workspaceName} on OpenStaff`, `You have been invited to join ${workspaceName} as ${role === 'admin' ? 'an administrator' : 'a member'}.`, url, 'Accept invitation', 'This invitation expires in seven days.')
}
