import { expect, it } from 'vitest'
import { browserHarness } from '../test/browser-harness.js'

type Harness = Awaited<ReturnType<typeof browserHarness>>

async function createRoom(h: Harness): Promise<string> {
  await h.page.goto(`${h.url}/login`, { waitUntil: 'domcontentloaded' })
  await h.page.locator('body[data-hydrated="true"]').waitFor()
  await h.page.getByRole('button', { name: 'Sign up', exact: true }).click()
  await h.page.getByPlaceholder('Your name').fill('Mobile Owner')
  await h.page.getByPlaceholder('Email', { exact: true }).fill('mobile-room@example.test')
  await h.page.getByPlaceholder('Password', { exact: true }).fill('browser-password123')
  await h.page.getByRole('button', { name: 'Create workspace account' }).click()
  await h.page.getByRole('button', { name: /Engineer/ }).click()
  await h.page.getByPlaceholder('e.g. Drake').fill('Mobile Bot')
  await h.page.getByRole('button', { name: 'Create teammate' }).click()
  await h.page.waitForURL(/\/rooms\/room_[^/]+$/, { waitUntil: 'domcontentloaded' })
  await h.page.getByRole('heading', { name: 'Mobile Bot', exact: true }).waitFor()
  return new URL(h.page.url()).pathname
}

it.skipIf(process.env.SKIP_BROWSER_TESTS === '1')('keeps the mobile room focused on chat until the computer is requested', async () => {
  const h = await browserHarness()
  try {
    const roomPath = await createRoom(h)
    await h.page.evaluate(() => {
      localStorage.setItem('openstaff.computerOpen', 'true')
      localStorage.setItem('openstaff.roomList', 'true')
    })
    await h.page.reload({ waitUntil: 'domcontentloaded' })
    await h.page.locator('body[data-hydrated="true"]').waitFor()
    const roomListToggle = h.page.getByRole('button', { name: 'Toggle room list', exact: true })
    await expect.poll(() => roomListToggle.getAttribute('aria-pressed')).toBe('true')
    await expect.poll(async () => (await h.page.locator('aside[aria-hidden]').boundingBox())?.width ?? 0).toBeGreaterThan(0)

    await h.page.setViewportSize({ width: 320, height: 568 })
    await h.page.reload({ waitUntil: 'domcontentloaded' })
    await h.page.locator('body[data-hydrated="true"]').waitFor()

    const composer = h.page.getByPlaceholder('Message Mobile Bot', { exact: true })
    await composer.waitFor()
    await expect.poll(() => h.page.getByRole('dialog', { name: 'Computer' }).count()).toBe(0)
    expect(await h.page.evaluate(() => localStorage.getItem('openstaff.computerOpen'))).toBe('true')
    expect(await h.page.evaluate(() => localStorage.getItem('openstaff.roomList'))).toBe('true')

    const send = h.page.getByRole('button', { name: 'Send', exact: true })
    const sendBounds = await send.boundingBox()
    expect(sendBounds).not.toBeNull()
    expect(sendBounds!.x).toBeGreaterThanOrEqual(0)
    expect(sendBounds!.x + sendBounds!.width).toBeLessThanOrEqual(320)
    const shellBounds = await h.page.locator('main').boundingBox()
    expect(shellBounds?.height).toBe(568)

    await composer.fill('Draft survives resize')
    await h.page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(() => h.page.evaluate(() => matchMedia('(min-width: 1024px)').matches)).toBe(true)
    await expect.poll(() => h.page.getByRole('button', { name: 'Close computer', exact: true }).isVisible()).toBe(true)
    await expect.poll(() => composer.inputValue()).toBe('Draft survives resize')
    await h.page.setViewportSize({ width: 320, height: 568 })
    await expect.poll(() => h.page.evaluate(() => matchMedia('(min-width: 1024px)').matches)).toBe(false)
    await expect.poll(() => h.page.getByRole('dialog', { name: 'Computer' }).count()).toBe(0)
    await expect.poll(() => composer.inputValue()).toBe('Draft survives resize')

    await send.click()
    const thread = h.page.locator('section').filter({ has: h.page.getByRole('heading', { name: 'Mobile Bot', exact: true }) })
    await thread.getByText('Draft survives resize', { exact: true }).waitFor()

    await h.page.getByRole('button', { name: 'Computer', exact: true }).click()
    const computer = h.page.getByRole('dialog', { name: 'Computer' })
    await computer.waitFor()
    await expect.poll(async () => {
      const bounds = await computer.boundingBox()
      return Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320)
    }).toBe(true)
    await computer.getByRole('button', { name: 'Close computer', exact: true }).click()
    await computer.waitFor({ state: 'detached' })
    await expect.poll(() => composer.isVisible()).toBe(true)
    expect(await h.page.evaluate(() => localStorage.getItem('openstaff.computerOpen'))).toBe('true')

    await h.page.goto(`${h.url}${roomPath}?computer=1`, { waitUntil: 'domcontentloaded' })
    await h.page.locator('body[data-hydrated="true"]').waitFor()
    await h.page.getByRole('dialog', { name: 'Computer' }).waitFor()
  } finally { await h.stop() }
}, 60_000)
