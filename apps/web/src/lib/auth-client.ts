import { createAuthClient } from 'better-auth/react'
import { adminClient, magicLinkClient, twoFactorClient } from 'better-auth/client/plugins'
import { ssoClient } from '@better-auth/sso/client'

export const authClient = createAuthClient({
  ...(typeof window === 'undefined' ? {} : { baseURL: window.location.origin }),
  basePath: '/api/auth',
  plugins: [magicLinkClient(), ssoClient({ domainVerification: { enabled: true } }), twoFactorClient({ twoFactorPage: '/two-factor' }), adminClient()],
})
