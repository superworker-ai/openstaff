import fs from 'node:fs/promises'
import path from 'node:path'
import { Sandbox } from 'e2b'
import { e2bError, e2bInstanceGone } from '../computer/e2b-errors.js'

const artifact = path.resolve('.context/e2b-contract-cleanup.json')

export async function recordE2BSandboxes(ids: Set<string>, verifiedAbsent = false) {
  await fs.mkdir(path.dirname(artifact), { recursive: true })
  // Only test-created IDs are recorded, never SDK objects or credentials.
  await fs.writeFile(artifact, JSON.stringify({ sandboxIds: [...ids], verifiedAbsent, checkedAt: new Date().toISOString() }, null, 2) + '\n')
}

export async function cleanupE2BSandboxes(ids: Set<string>, apiKey?: string) {
  if (!ids.size) return
  for (const id of ids) {
    try {
      await Sandbox.kill(id, { apiKey })
      let exists = false
      try { await Sandbox.getInfo(id, { apiKey }); exists = true }
      catch (error) { if (!e2bInstanceGone(error)) throw error }
      if (exists) throw new Error('Test sandbox still exists after cleanup')
    } catch (error) { throw e2bError(error) }
  }
  await recordE2BSandboxes(ids, true)
  console.log(`E2B cleanup verified with SDK: ${ids.size} test sandbox(s) absent; 0 running`)
}
