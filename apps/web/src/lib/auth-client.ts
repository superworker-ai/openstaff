import { createAuthClient } from 'better-auth/react'
import { adminClient, magicLinkClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  ...(typeof window === 'undefined' ? {} : { baseURL: window.location.origin }),
  basePath: '/api/auth',
  plugins: [magicLinkClient(), adminClient()],
})
