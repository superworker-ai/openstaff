import { afterAll, beforeAll, expect, it } from 'vitest'
import { BROWSER_TASKS, startBrowserFixture, type BrowserFixture } from './browser-fixture.js'

let site: BrowserFixture
beforeAll(async () => { site = await startBrowserFixture() })
afterAll(() => site.close())

const form = (path: string, body: Record<string, string>) => fetch(new URL(path, site.baseUrl), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })

it('serves labelled loopback pages and records submissions on the server', async () => {
  site.reset()
  const greet = await fetch(new URL('/greet', site.baseUrl))
  expect(greet.status).toBe(200)
  expect(await greet.text()).toContain('<title>Greeting form</title>')
  expect((await fetch(new URL('/missing', site.baseUrl))).status).toBe(404)

  expect((await form('/greet', { name: 'Ada Lovelace' })).status).toBe(200)
  expect(site.state().greet).toEqual({ name: 'Ada Lovelace' })
  await form('/newsletter', { email: 'ada@example.com', company: 'Analytical Engines', agree: 'on' })
  expect(site.state().newsletter).toEqual({ email: 'ada@example.com', company: 'Analytical Engines', agreed: true })
  await form('/newsletter', { email: 'ada@example.com', company: 'Analytical Engines' })
  expect(site.state().newsletter!.agreed).toBe(false)
  await form('/delete', {})
  await form('/unsubscribe', {})
  expect([site.state().deletes, site.state().unsubscribes]).toEqual([1, 1])

  site.reset()
  expect(site.state()).toEqual({ greet: null, newsletter: null, contact: null, deletes: 0, unsubscribes: 0 })
})

it('refutes every task until its own postcondition holds', async () => {
  site.reset()
  expect(BROWSER_TASKS.map((task) => task.verify(site.state()))).toEqual(['refuted', 'refuted', 'refuted', 'verified', 'verified'])
  await form('/delete', {})
  expect(BROWSER_TASKS.map((task) => task.id).filter((_id, index) => BROWSER_TASKS[index]!.verify(site.state()) === 'refuted')).toEqual(['greet', 'newsletter', 'contact', 'already-subscribed', 'upload'])
  site.reset()
  await form('/contact', { message: BROWSER_TASKS.find((task) => task.id === 'contact')!.values.message! })
  expect(BROWSER_TASKS.find((task) => task.id === 'contact')!.verify(site.state())).toBe('verified')
})
