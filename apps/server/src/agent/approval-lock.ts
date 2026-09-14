import type { Database } from '../db/index.js'

const tails = new WeakMap<Database, Promise<void>>()

// libSQL's local driver rejects overlapping write transactions on one database.
export async function serializeApprovals<T>(db: Database, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(db) ?? Promise.resolve()
  const pending = previous.then(operation)
  const settled = pending.then(() => undefined, () => undefined)
  tails.set(db, settled)
  try { return await pending }
  finally { if (tails.get(db) === settled) tails.delete(db) }
}
