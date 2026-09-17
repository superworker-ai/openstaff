import { Resend } from 'resend'
import type { SendEmail } from './types.js'

export function resendMailer(apiKey: string, from: string): SendEmail {
  const resend = new Resend(apiKey)
  return async ({ to, subject, text, html }) => {
    const result = await resend.emails.send({ from, to, subject, text, html })
    if (result.error) throw new Error(`Resend email failed: ${result.error.message}`)
  }
}
