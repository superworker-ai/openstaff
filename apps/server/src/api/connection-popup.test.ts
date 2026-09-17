import { expect, it } from 'vitest'
import { connectionFailurePopup, connectionPopup } from './connection-popup.js'

const origin = 'https://staff.example.com/api/connections/callback?approval=approval_1'

it('closes the success popup outside the opener gate and nonces both script and style', async () => {
  const response = connectionPopup('Gmail', 'approval_1', origin)
  const html = await response.text()
  expect(response.status).toBe(200)
  expect(html).toContain('if(window.opener)window.opener.postMessage({"type":"openstaff:connected","app":"Gmail","approvalId":"approval_1"},"https://staff.example.com");window.close()')
  expect(html).not.toContain('if(window.opener){')
  expect(html).toContain('Connected. You can close this window.')
  expect(html).toContain('Return to OpenStaff')
  const nonce = /<style nonce="([^"]+)"/.exec(html)?.[1]
  expect(nonce).toBeTruthy()
  expect(html).toContain(`<script nonce="${nonce}">`)
  expect(response.headers.get('content-security-policy')).toBe(`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
})

it('renders a failure page with the reason, a retry link, and a close button', async () => {
  const response = connectionFailurePopup('Gmail', 'Sign-in did not finish. Try connecting again.', origin, '/api/connections/start?toolkit=gmail&approval=approval_1')
  const html = await response.text()
  expect(response.status).toBe(200)
  expect(html).toContain('Could not connect Gmail')
  expect(html).toContain('Sign-in did not finish. Try connecting again.')
  expect(html).toContain('<a href="/api/connections/start?toolkit=gmail&amp;approval=approval_1">Try again</a>')
  expect(html).toContain('<button type="button" id="close">Close</button>')
  expect(html).toContain("document.getElementById('close').addEventListener('click',function(){window.close()})")
  expect(await connectionFailurePopup('this app', 'Connection request not found or already completed.', origin).text()).not.toContain('Try again')
})

it('escapes the app name and the message as HTML text', async () => {
  expect(await connectionPopup('<img src=x>&"', undefined, origin).text()).toContain('&lt;img src=x&gt;&amp;&quot; connected')
  const failure = await connectionFailurePopup('<b>App</b>', 'Bad "key" & <script>alert(1)</script>', origin).text()
  expect(failure).toContain('Could not connect &lt;b&gt;App&lt;/b&gt;')
  expect(failure).toContain('Bad &quot;key&quot; &amp; &lt;script&gt;alert(1)&lt;/script&gt;')
  expect(failure).not.toContain('<script>alert(1)')
})
