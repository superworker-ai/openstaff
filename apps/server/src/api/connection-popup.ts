import { randomBytes } from 'node:crypto'

export function connectionPopup(app: string, approvalId: string | undefined, origin: string): Response {
  const nonce = randomBytes(16).toString('base64')
  const payload = JSON.stringify({ type: 'openstaff:connected', app, approvalId: approvalId ?? null }).replaceAll('<', '\\u003c')
  const target = JSON.stringify(new URL(origin).origin).replaceAll('<', '\\u003c')
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Connected</title></head><body><p role="status">Connected, you can close this tab</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${payload},${target});window.close()}</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'` } })
}
