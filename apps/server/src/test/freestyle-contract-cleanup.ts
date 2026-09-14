import fs from 'node:fs/promises'
import path from 'node:path'
import { Freestyle } from 'freestyle-sandboxes'
import { freestyleError, freestyleInstanceGone } from '../computer/freestyle-errors.js'

const artifact = path.resolve('.context/freestyle-contract-cleanup.json')

export async function recordFreestyleVms(ids: Set<string>, verifiedAbsent = false) {
  await fs.mkdir(path.dirname(artifact), { recursive: true })
  await fs.writeFile(artifact, JSON.stringify({ vmIds: [...ids], verifiedAbsent, checkedAt: new Date().toISOString() }, null, 2) + '\n')
}

export async function cleanupFreestyleVms(ids: Set<string>, apiKey?: string, baseUrl?: string) {
  if (!ids.size) return
  const freestyle = new Freestyle({ apiKey, baseUrl: baseUrl || undefined })
  for (const vmId of ids) {
    const vm = (await freestyle.vms.get({ vmId })).vm
    try { await vm.getInfo(); await vm.delete() } catch (error) { if (!freestyleInstanceGone(error)) throw freestyleError(error) }
    try { await vm.getInfo(); throw new Error('Test VM still exists after cleanup') } catch (error) { if (!freestyleInstanceGone(error)) throw error }
  }
  await recordFreestyleVms(ids, true)
  console.log(`Freestyle cleanup verified with SDK: ${ids.size} test VM(s) absent; 0 running`)
}
