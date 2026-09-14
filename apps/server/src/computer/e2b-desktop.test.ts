import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Sandbox } from '@e2b/desktop'
import { Sandbox as BaseSandbox, Volume } from 'e2b'
import { E2BDesktop } from './e2b-desktop.js'
import { e2bProvider } from './e2b.js'
import type { ComputerInstanceRecord } from './provider.js'
import type { ManagedComputer } from './types.js'

function sandbox() {
  let authNumber = 0
  const methods = {
    leftClick: vi.fn(async () => undefined), middleClick: vi.fn(async () => undefined), doubleClick: vi.fn(async () => undefined), rightClick: vi.fn(async () => undefined),
    moveMouse: vi.fn(async () => undefined), drag: vi.fn(async () => undefined), scroll: vi.fn(async () => undefined), write: vi.fn(async () => undefined), press: vi.fn(async () => undefined),
  }
  const stream = {
    start: vi.fn(async () => { authNumber += 1 }), stop: vi.fn(async () => undefined), getAuthKey: vi.fn(() => `rotated-${authNumber}`),
    getUrl: vi.fn(({ viewOnly, authKey }: { viewOnly?: boolean; authKey?: string }) => `https://stream.example.test/${viewOnly ? 'viewer' : 'controller'}?key=${authKey}`),
  }
  const value = {
    sandboxId: 'desktop-new', display: ':0', stream, ...methods,
    getHost: vi.fn((port: number) => `${port}-desktop.e2b.test`),
    waitAndVerify: vi.fn(async () => true),
    screenshot: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    getScreenSize: vi.fn(async () => ({ width: 1280, height: 800 })),
    getCursorPosition: vi.fn(async () => ({ x: 12, y: 34 })),
    getApplicationWindows: vi.fn(async () => ['42']), getCurrentWindowId: vi.fn(async () => '42'), getWindowTitle: vi.fn(async () => 'Chromium'), launch: vi.fn(async () => undefined),
    commands: { run: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0, disconnect: vi.fn(async () => undefined) })) },
    files: { write: vi.fn(async () => undefined), read: vi.fn(async () => 'hello'), makeDir: vi.fn(async () => undefined), list: vi.fn(async () => []), getInfo: vi.fn(async () => ({ type: 'file', size: 5 })) },
  }
  return { value: value as unknown as Sandbox, stream, methods, raw: value }
}

beforeEach(() => {
  vi.stubEnv('E2B_DESKTOP', '1')
  vi.stubEnv('E2B_DESKTOP_TEMPLATE', 'desktop-test')
  vi.spyOn(Volume, 'list').mockResolvedValue([])
  vi.spyOn(Volume, 'create').mockResolvedValue({ volumeId: 'volume-new', name: 'openstaff-workspace-one' } as Volume)
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

it('replaces a legacy base sandbox on the desktop template with the same volume', async () => {
  const fake = sandbox(), volume = { volumeId: 'volume-saved', name: 'openstaff-workspace-one' } as Volume
  const record: ComputerInstanceRecord = { id: 'one', provider: 'e2b', externalId: 'legacy-base', status: 'ready', createdAt: '', lastSeenAt: '', metadata: { e2bVolumeId: volume.volumeId, e2bVolumeName: volume.name } }
  vi.spyOn(Volume, 'connect').mockResolvedValue(volume)
  const kill = vi.spyOn(BaseSandbox, 'kill').mockResolvedValue(true)
  const connect = vi.spyOn(Sandbox, 'connect')
  const create = vi.spyOn(Sandbox, 'create').mockResolvedValue(fake.value)
  const persist = vi.fn()

  const computer = await e2bProvider.open({ credentials: { apiKey: 'sdk-canary' }, workspaceRoot: '', instanceId: 'one', instance: record, persist })

  expect(kill).toHaveBeenCalledWith('legacy-base', { apiKey: 'sdk-canary' })
  expect(connect).not.toHaveBeenCalled()
  expect(create).toHaveBeenCalledWith('desktop-test', expect.objectContaining({ resolution: [1280, 800], volumeMounts: { '/workspace': volume } }))
  expect(persist).toHaveBeenCalledWith(expect.objectContaining({ status: 'recreated', metadata: expect.objectContaining({ e2bDesktop: true, e2bDesktopTemplate: 'desktop-test', e2bVolumeId: 'volume-saved' }) }))
  expect(computer.notice).toContain('workspace preserved by volume')
})

it('starts a protected stream once and rotates its controller key on revoke', async () => {
  const fake = sandbox()
  vi.spyOn(Sandbox, 'create').mockResolvedValue(fake.value)
  const computer = await e2bProvider.open({ credentials: { apiKey: 'sdk-canary' }, workspaceRoot: '', instanceId: 'one', instance: null, persist: vi.fn() })
  const first = await computer.desktop!()
  const again = await computer.desktop!()
  expect(first?.kind).toBe('external')
  expect(again?.kind).toBe('external')
  expect(fake.stream.start).toHaveBeenCalledTimes(1)
  if (first?.kind !== 'external') throw new Error('Expected external desktop')
  const original = await first.controllerUrl()
  await first.revoke()
  const rotated = await first.controllerUrl()
  expect(original).not.toBe(rotated)
  expect(fake.stream.start).toHaveBeenCalledTimes(2)
})

it('revalidates a surviving stream after resume without starting a second one', async () => {
  const fake = sandbox(), desktop = new E2BDesktop(fake.value)
  await desktop.initialize()
  await desktop.beforePause()
  await desktop.afterResume(fake.value)
  expect(fake.stream.start).toHaveBeenCalledTimes(1)
  await expect(desktop.viewerUrl()).resolves.toContain('rotated-1')
})

it('maps desktop input, chords, screenshots, cursor, and windows to the desktop SDK', async () => {
  const fake = sandbox(), desktop = new E2BDesktop(fake.value)
  await desktop.input({ type: 'click', x: 1, y: 2 })
  await desktop.input({ type: 'click', x: 3, y: 4, button: 2 })
  await desktop.input({ type: 'double_click', x: 5, y: 6 })
  await desktop.input({ type: 'right_click', x: 7, y: 8 })
  await desktop.input({ type: 'move', x: 9, y: 10 })
  await desktop.input({ type: 'drag', fromX: 1, fromY: 2, toX: 3, toY: 4 })
  await desktop.input({ type: 'scroll', x: 11, y: 12, direction: 'down', amount: 3 })
  await desktop.input({ type: 'type', text: 'hello' })
  await desktop.input({ type: 'key', key: 'ctrl+l' })
  await desktop.input({ type: 'key', key: 'Return' })

  expect(fake.methods.leftClick).toHaveBeenCalledWith(1, 2)
  expect(fake.methods.middleClick).toHaveBeenCalledWith(3, 4)
  expect(fake.methods.doubleClick).toHaveBeenCalledWith(5, 6)
  expect(fake.methods.rightClick).toHaveBeenCalledWith(7, 8)
  expect(fake.methods.drag).toHaveBeenCalledWith([1, 2], [3, 4])
  expect(fake.methods.moveMouse).toHaveBeenCalledWith(11, 12)
  expect(fake.methods.scroll).toHaveBeenCalledWith('down', 3)
  expect(fake.methods.write).toHaveBeenCalledWith('hello')
  expect(fake.methods.press).toHaveBeenNthCalledWith(1, ['ctrl', 'l'])
  expect(fake.methods.press).toHaveBeenNthCalledWith(2, 'Return')
  await expect(desktop.captureScreen()).resolves.toEqual({ image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mediaType: 'image/png', width: 1280, height: 800 })
  await expect(desktop.cursor()).resolves.toEqual({ x: 12, y: 34 })
  await expect(desktop.windows()).resolves.toEqual([{ id: '0x2a', title: 'Chromium', active: true }])
})

it('exposes desktop methods only when E2B desktop mode is enabled', async () => {
  expect(e2bProvider.capabilities.desktop).toBe(true)
  vi.stubEnv('E2B_DESKTOP', '0')
  expect(e2bProvider.capabilities.desktop).toBe(false)
  const fake = sandbox()
  vi.spyOn(BaseSandbox, 'create').mockResolvedValue(fake.value)
  const computer = await e2bProvider.open({ credentials: { apiKey: 'sdk-canary' }, workspaceRoot: '', instanceId: 'one', instance: null, persist: vi.fn() }) as ManagedComputer
  expect(computer.runtimeCapabilities?.desktop).toBe(false)
  expect(computer.desktop).toBeDefined()
  await expect(computer.desktop!()).resolves.toBeNull()
})
