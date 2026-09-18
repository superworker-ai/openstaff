import { Layout, type EmailContext } from './Layout.js'

export type InvitationProps = EmailContext & { url: string; workspaceName: string; role: 'admin' | 'member' }

export function Invitation({ url, workspaceName, role, inviterName, appUrl }: InvitationProps) {
  return (
    <Layout preview={`You're invited to ${workspaceName}`} heading={`You're invited to ${workspaceName}`} action={{ label: 'Accept invitation', url }} footer="This invitation expires in seven days." workspaceName={workspaceName} appUrl={appUrl}>
      {`${inviterName ?? 'Someone'} invited you to join ${workspaceName} as ${role === 'admin' ? 'an administrator' : 'a member'}.`}
    </Layout>
  )
}

Invitation.PreviewProps = { url: 'https://app.openstaff.test/invite/preview', workspaceName: 'Acme', role: 'admin', inviterName: 'Dana', appUrl: 'https://app.openstaff.test' } satisfies InvitationProps

export default Invitation
