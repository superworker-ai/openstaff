import type { TurnEventRecorder } from '../agent/events.js'
import type { ComputerLeaseGate } from './lease.js'

export interface DisplayOperationState {
  resumed: boolean
}

export class DisplayGate {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly lease?: ComputerLeaseGate) {}

  run<T>(recorder: TurnEventRecorder, signal: AbortSignal | undefined, operation: (state: DisplayOperationState) => Promise<T>): Promise<{ value: T; controlChanged: boolean }> {
    const result = this.tail.then(async () => {
      let startingLease = await this.lease?.current()
      let resumed = false
      if (startingLease?.ownerKind === 'human') {
        await recorder.record('status', { status: 'paused', reason: 'human_control', by: startingLease.ownerName })
        do {
          await this.lease!.waitForBot(signal)
          startingLease = await this.lease!.current()
        } while (startingLease.ownerKind === 'human')
        await recorder.record('status', { status: 'resumed', reason: 'control_returned' })
        resumed = true
      }
      const value = await operation({ resumed })
      const endingLease = await this.lease?.current()
      return { value, controlChanged: Boolean(startingLease && endingLease && startingLease.epoch !== endingLease.epoch) }
    })
    this.tail = result.catch(() => undefined)
    return result
  }
}
