import { Layout, type EmailContext } from './Layout.js'

export type ResetPasswordProps = EmailContext & { url: string }

export function ResetPassword({ url, workspaceName, appUrl }: ResetPasswordProps) {
  return (
    <Layout preview="Reset your password" heading="Reset your password" action={{ label: 'Reset password', url }} footer="This link expires in one hour. If you did not ask for this, ignore this email." workspaceName={workspaceName} appUrl={appUrl}>
      Choose a new password for your account.
    </Layout>
  )
}

ResetPassword.PreviewProps = { url: 'https://app.openstaff.test/reset-password?token=preview', workspaceName: 'Acme', appUrl: 'https://app.openstaff.test' } satisfies ResetPasswordProps

export default ResetPassword
