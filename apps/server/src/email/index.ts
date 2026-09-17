import type { Config } from '../config.js'
import { consoleMailer } from './console.js'
import { resendMailer } from './resend.js'
import { smtpMailer } from './smtp.js'
import type { SendEmail } from './types.js'

export type { EmailMessage, SendEmail } from './types.js'

export function createMailer(config: Config): SendEmail {
  if (config.email.provider === 'console') return consoleMailer
  if (!config.email.from) throw new Error('EMAIL_FROM is required when EMAIL_PROVIDER is not console')
  if (config.email.provider === 'smtp') {
    if (!config.email.smtpUrl) throw new Error('SMTP_URL is required when EMAIL_PROVIDER=smtp')
    return smtpMailer(config.email.smtpUrl, config.email.from)
  }
  if (!config.email.resendApiKey) throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend')
  return resendMailer(config.email.resendApiKey, config.email.from)
}
