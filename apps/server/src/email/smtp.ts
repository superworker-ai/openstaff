import nodemailer from 'nodemailer'
import type { SendEmail } from './types.js'

export function smtpMailer(url: string, from: string): SendEmail {
  const transport = nodemailer.createTransport(url)
  return async (message) => { await transport.sendMail({ from, ...message }) }
}
