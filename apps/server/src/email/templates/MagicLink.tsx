import { Layout, type EmailContext } from './Layout.js'

export type MagicLinkProps = EmailContext & { url: string }

export function MagicLink({ url, workspaceName, appUrl }: MagicLinkProps) {
  return (
    <Layout preview="Your sign-in link" heading="Your sign-in link" action={{ label: 'Sign in', url }} footer="This link expires in five minutes." workspaceName={workspaceName} appUrl={appUrl}>
      Use this link to sign in. It works once.
    </Layout>
  )
}

MagicLink.PreviewProps = { url: 'https://app.openstaff.test/api/auth/magic-link/verify?token=preview', workspaceName: 'Acme', appUrl: 'https://app.openstaff.test' } satisfies MagicLinkProps

export default MagicLink
