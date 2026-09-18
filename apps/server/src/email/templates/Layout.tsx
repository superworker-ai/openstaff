import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Text } from '@react-email/components'
import type { ReactNode } from 'react'

// What a caller knows about the recipient's workspace; every template accepts it and passes it down.
export interface EmailContext {
  workspaceName?: string
  appUrl?: string
  inviterName?: string
}

export interface LayoutProps extends Pick<EmailContext, 'workspaceName' | 'appUrl'> {
  preview: string
  heading: string
  children: ReactNode
  action?: { label: string; url: string }
  footer?: string
}

// Inline styles only: React Email keeps them on the element, which is the one thing every mail client honours.
const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const page = { backgroundColor: '#f4f4f5', color: '#18181b', fontFamily: font, margin: '0', padding: '32px 0' }
const card = { backgroundColor: '#ffffff', borderRadius: '8px', margin: '0 auto', maxWidth: '560px', padding: '32px' }
const wordmark = { color: '#18181b', fontSize: '15px', fontWeight: 600, letterSpacing: '-0.01em', margin: '0 0 28px' }
const title = { color: '#18181b', fontSize: '22px', fontWeight: 600, lineHeight: '30px', margin: '0 0 12px' }
const body = { color: '#18181b', fontSize: '15px', lineHeight: '24px', margin: '0 0 24px' }
const button = { backgroundColor: '#18181b', borderRadius: '6px', color: '#ffffff', display: 'inline-block', fontSize: '15px', fontWeight: 600, padding: '12px 20px', textDecoration: 'none' }
const muted = { color: '#71717a', fontSize: '13px', lineHeight: '20px', margin: '24px 0 0' }
const rawLink = { color: '#71717a', fontSize: '13px', textDecoration: 'underline', wordBreak: 'break-all' as const }
const rule = { borderColor: '#e4e4e7', margin: '28px 0 16px' }
const footnote = { color: '#71717a', fontSize: '12px', lineHeight: '18px', margin: '0' }

function hostOf(appUrl: string): string | undefined {
  try { return new URL(appUrl).host } catch { return undefined }
}

export function brandLine({ workspaceName, appUrl }: Pick<EmailContext, 'workspaceName' | 'appUrl'>): string {
  const brand = workspaceName ? `${workspaceName} on OpenStaff` : 'OpenStaff'
  const host = appUrl ? hostOf(appUrl) : undefined
  return host ? `${brand} · ${host}` : brand
}

export function Layout({ preview, heading, children, action, footer, workspaceName, appUrl }: LayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={page}>
        <Container style={card}>
          <Text style={wordmark}>OpenStaff</Text>
          <Heading style={title}>{heading}</Heading>
          <Text style={body}>{children}</Text>
          {action ? (
            <>
              <Button href={action.url} style={button}>{action.label}</Button>
              <Text style={muted}>
                If the button does not work, paste this link into your browser:{' '}
                <Link href={action.url} style={rawLink}>{action.url}</Link>
              </Text>
            </>
          ) : null}
          {footer ? <Text style={muted}>{footer}</Text> : null}
          <Hr style={rule} />
          <Text style={footnote}>{brandLine({ workspaceName, appUrl })}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default Layout
