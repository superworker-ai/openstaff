import fs from 'node:fs/promises'
import path from 'node:path'
import type { JsonValue } from '@openstaff/shared'
import type { TurnEventRecorder } from '../agent/events.js'

export class ScreenRecorder {
  private tail: Promise<unknown> = Promise.resolve()
  private nextNumber?: number
  private lastDesktopAutomatic = Number.NEGATIVE_INFINITY

  constructor(private readonly dataDir: string, private readonly turnId: string, private recorder: TurnEventRecorder) {}

  bind(recorder: TurnEventRecorder): void { this.recorder = recorder }

  claimDesktopAutomatic(intervalMs = 700, now = Date.now(), force = false): boolean {
    if (!force && now - this.lastDesktopAutomatic < intervalMs) return false
    this.lastDesktopAutomatic = now
    return true
  }

  private save<T extends Record<string, JsonValue>>(image: Uint8Array, extension: 'jpg' | 'png', payload: T): Promise<T & { url: string }> {
    const result = this.tail.then(async () => {
      const directory = path.join(this.dataDir, 'screens', this.turnId)
      await fs.mkdir(directory, { recursive: true })
      if (this.nextNumber === undefined) {
        const existing = await fs.readdir(directory)
        this.nextNumber = Math.max(0, ...existing.map((name) => Number.parseInt(name, 10) || 0)) + 1
      }
      const number = this.nextNumber++
      const url = `/api/screens/${this.turnId}/${number}.${extension}`
      await fs.writeFile(path.join(directory, `${number}.${extension}`), image)
      const eventPayload = { url, ...payload }
      await this.recorder.record('screenshot', eventPayload)
      return eventPayload as T & { url: string }
    })
    this.tail = result.catch(() => undefined)
    return result
  }

  saveJpeg<T extends Record<string, JsonValue>>(jpeg: Uint8Array, payload: T): Promise<T & { url: string }> {
    return this.save(jpeg, 'jpg', payload)
  }

  saveImage<T extends Record<string, JsonValue>>(image: Uint8Array, mediaType: 'image/jpeg' | 'image/png', payload: T): Promise<T & { url: string; mediaType: 'image/jpeg' | 'image/png' }> {
    return this.save(image, mediaType === 'image/png' ? 'png' : 'jpg', { ...payload, mediaType })
  }

  readUrl(url: string): Promise<Buffer> {
    const match = new RegExp(`^/api/screens/${this.turnId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([1-9]\\d*)\\.(jpg|png)$`).exec(url)
    if (!match) throw new Error('Invalid screenshot URL')
    return fs.readFile(path.join(this.dataDir, 'screens', this.turnId, `${match[1]}.${match[2]}`))
  }
}
