import { randomBytes } from 'node:crypto'

/** Popup pages carry no app bundle, so the Skydive dark and Notion light tokens are inlined here. */
const styles = `body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d0d0f;color:#f2f2f3;font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}main{box-sizing:border-box;width:min(22rem,100%);margin:1.5rem;padding:1.5rem;border:1px solid rgb(255 255 255/.08);border-radius:.75rem;background:#141416;text-align:center}h1{margin:0 0 .5rem;font-size:1rem;font-weight:600}p{margin:0;color:#a3a3ab}.actions{margin-top:1.25rem;display:flex;gap:.5rem;justify-content:center}a,button{font:inherit;padding:.5rem 1rem;border:1px solid rgb(255 255 255/.16);border-radius:.5rem;background:transparent;color:#f2f2f3;text-decoration:none;cursor:pointer}[hidden]{display:none}@media(prefers-color-scheme:light){body{background:#f9f8f7;color:#2c2c2b}main{border-color:rgb(42 28 0/.07);background:#fff}p{color:#6d6a66}a,button{border-color:rgb(28 19 1/.11);color:#2c2c2b}}`

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') }

function popupPage(title: string, body: string, script: string): Response {
  const nonce = randomBytes(16).toString('base64')
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style nonce="${nonce}">${styles}</style></head><body><main>${body}</main><script nonce="${nonce}">${script}</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'` } })
}

/** `window.close()` stays outside the opener gate: a COOP-sending identity provider nulls `opener`, and a popup can still close itself. */
export function connectionPopup(app: string, approvalId: string | undefined, origin: string): Response {
  const payload = JSON.stringify({ type: 'openstaff:connected', app, approvalId: approvalId ?? null }).replaceAll('<', '\\u003c')
  const target = JSON.stringify(new URL(origin).origin).replaceAll('<', '\\u003c')
  return popupPage('Connected', `<h1>${escapeHtml(app)} connected</h1><p role="status">Connected. You can close this window.</p><p class="actions" id="return" hidden><a href="/">Return to OpenStaff</a></p>`, `if(window.opener)window.opener.postMessage(${payload},${target});window.close();setTimeout(function(){var r=document.getElementById('return');if(r)r.hidden=false},400)`)
}

export function connectionFailurePopup(app: string, message: string, origin: string, retryHref?: string): Response {
  return popupPage('Could not connect', `<h1>Could not connect ${escapeHtml(app)}</h1><p role="alert">${escapeHtml(message)}</p><p class="actions">${retryHref ? `<a href="${escapeHtml(retryHref)}">Try again</a>` : ''}<button type="button" id="close">Close</button></p>`, `document.getElementById('close').addEventListener('click',function(){window.close()})`)
}
