export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export type SendEmail = (message: EmailMessage) => Promise<void>
