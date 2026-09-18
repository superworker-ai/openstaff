import { Layout, type EmailContext } from './Layout.js'

export type VerifyEmailProps = EmailContext & { url: string }

export function VerifyEmail({ url, workspaceName, appUrl }: VerifyEmailProps) {
  return (
    <Layout preview="Verify your email" heading="Verify your email" action={{ label: 'Verify email', url }} footer="This link expires in one hour." workspaceName={workspaceName} appUrl={appUrl}>
      {`Confirm this address to finish signing in to ${workspaceName ?? 'OpenStaff'}.`}
    </Layout>
  )
}

VerifyEmail.PreviewProps = { url: 'https://app.openstaff.test/verify-email?token=preview', workspaceName: 'Acme', appUrl: 'https://app.openstaff.test' } satisfies VerifyEmailProps

export default VerifyEmail
