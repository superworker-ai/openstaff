import type { SendEmail } from './types.js'

export const consoleMailer: SendEmail = async ({ to, subject, text }) => {
  console.log(`[email] to=${to} subject=${subject}`)
  const url = text.match(/https?:\/\/\S+/)?.[0]
  if (url) console.log(url)
}
