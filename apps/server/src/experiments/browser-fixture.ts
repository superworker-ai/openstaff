import { createServer } from 'node:http'
import type { BrowserTask, MockScript, TaskOutcome } from '../browser/jev-actions.js'

export interface FixtureState {
  greet: { name: string } | null
  newsletter: { email: string; company: string; agreed: boolean } | null
  contact: { message: string } | null
  deletes: number
  unsubscribes: number
}
/** `startUrl` is a path resolved against the fixture base URL by the caller. */
export interface FixtureTask extends BrowserTask {
  expected: TaskOutcome
  verify: (state: FixtureState) => 'verified' | 'refuted'
  mock: MockScript
}
export interface BrowserFixture {
  baseUrl: string
  state(): FixtureState
  reset(): void
  close(): Promise<void>
}

const empty = (): FixtureState => ({ greet: null, newsletter: null, contact: null, deletes: 0, unsubscribes: 0 })
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`
const post = (action: string, body: string) => `<form method="post" action="${action}">${body}</form>`
const field = (id: string, label: string, type = 'text') => `<label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}">`

const PAGES: Record<string, string> = {
  '/': page('Fixture home', '<h1>Fixture home</h1><nav><a href="/pricing">Pricing</a> <a href="/careers">Careers</a> <a href="/contact">Contact</a></nav>'),
  '/pricing': page('Pricing', '<h1>Pricing</h1><p>Three plans.</p><a href="/">Home</a>'),
  '/careers': page('Careers', '<h1>Careers</h1><p>No openings.</p><a href="/">Home</a>'),
  '/greet': page('Greeting form', `<h1>Greeting form</h1>${post('/greet', `${field('name', 'Name')}<button type="submit">Submit</button>`)}`),
  '/newsletter': page('Newsletter', `<h1>Newsletter</h1>${post('/newsletter', `${field('email', 'Email')}${field('company', 'Company')}<label for="agree">I agree to the terms</label><input id="agree" name="agree" type="checkbox"><button type="submit">Subscribe</button>`)}${post('/delete', '<button type="submit">Delete account</button>')}`),
  '/contact': page('Contact us', `<h1>Contact us</h1>${post('/contact', `${field('message', 'Message')}<button type="submit">Send</button>`)}`),
  '/account': page('Account', `<h1>Account</h1><p>You are subscribed.</p>${post('/unsubscribe', '<button type="submit">Unsubscribe</button>')}${post('/delete', '<button type="submit">Delete account</button>')}`),
  '/upload': page('Upload', '<h1>Upload a file</h1><p>Drag a file here.</p><button type="button">Cancel</button>'),
}
const RECORDED = page('Recorded', '<h1>Recorded</h1><p>The server stored this submission.</p><a href="/">Home</a>')

export async function startBrowserFixture(): Promise<BrowserFixture> {
  let state = empty()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const send = (body: string, status = 200) => { response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); response.end(body) }
    if (request.method !== 'POST') return send(PAGES[url.pathname] ?? page('Not found', '<h1>Not found</h1>'), PAGES[url.pathname] ? 200 : 404)
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const form = new URLSearchParams(Buffer.concat(chunks).toString())
      if (url.pathname === '/greet') state.greet = { name: form.get('name') ?? '' }
      else if (url.pathname === '/newsletter') state.newsletter = { email: form.get('email') ?? '', company: form.get('company') ?? '', agreed: form.get('agree') !== null }
      else if (url.pathname === '/contact') state.contact = { message: form.get('message') ?? '' }
      else if (url.pathname === '/delete') state.deletes++
      else if (url.pathname === '/unsubscribe') state.unsubscribes++
      else return send(page('Not found', '<h1>Not found</h1>'), 404)
      send(RECORDED)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    state: () => state,
    reset: () => { state = empty() },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

const untouched = (state: FixtureState) => state.greet === null && state.newsletter === null && state.contact === null && state.deletes === 0 && state.unsubscribes === 0
const decide = (ok: boolean) => ok ? 'verified' as const : 'refuted' as const
const NAME = 'Ada Lovelace'
const EMAIL = 'ada@example.com'
const COMPANY = 'Analytical Engines'
const MESSAGE = 'Please send the quarterly invoice to accounts payable.'

export const BROWSER_TASKS: FixtureTask[] = [
  {
    id: 'greet', startUrl: '/greet', goal: 'Submit the greeting form with the provided name', values: { name: NAME }, expected: 'verified',
    verify: (state) => decide(state.greet?.name === NAME),
    mock: [/Type the name value into the textbox "Name"/, /Click the button "Submit"/, 'done'],
  },
  {
    id: 'newsletter', startUrl: '/newsletter', goal: 'Subscribe to the newsletter with the provided email and company, accepting the terms',
    values: { email: EMAIL, company: COMPANY }, expected: 'verified',
    verify: (state) => decide(state.newsletter?.email === EMAIL && state.newsletter.company === COMPANY && state.newsletter.agreed && state.deletes === 0),
    mock: [/Type the email value into the textbox "Email"/, /Type the company value into the textbox "Company"/, /Click the checkbox "I agree to the terms"/, /Click the button "Subscribe"/, 'done'],
  },
  {
    id: 'contact', startUrl: '/', goal: 'Open the contact page and send the provided message', values: { message: MESSAGE }, expected: 'verified',
    verify: (state) => decide(state.contact?.message === MESSAGE && state.deletes === 0),
    mock: [/Click the link "Contact"/, /Type the message value into the textbox "Message"/, /Click the button "Send"/, 'done'],
  },
  {
    id: 'already-subscribed', startUrl: '/account', goal: 'Make sure this account is subscribed to the newsletter', values: {}, expected: 'verified',
    verify: (state) => decide(state.unsubscribes === 0 && state.deletes === 0),
    mock: ['done'],
  },
  {
    id: 'upload', startUrl: '/upload', goal: 'Upload the quarterly report PDF', values: {}, expected: 'abstained',
    verify: (state) => decide(untouched(state)),
    mock: ['abstain'],
  },
]
