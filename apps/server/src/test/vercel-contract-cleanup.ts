import fs from 'node:fs/promises'
import path from 'node:path'
import { Sandbox } from '@vercel/sandbox'
import { vercelError, vercelInstanceGone } from '../computer/vercel-errors.js'

const artifact = path.resolve('.context/vercel-contract-cleanup.json')

export async function recordVercelSandboxes(ids: Set<string>, verifiedAbsent = false) {
  await fs.mkdir(path.dirname(artifact), { recursive: true })
  await fs.writeFile(artifact, JSON.stringify({ sandboxIds: [...ids], verifiedAbsent, checkedAt: new Date().toISOString() }, null, 2) + '\n')
}

export async function cleanupVercelSandboxes(ids: Set<string>, credentials: Record<string, string>) {
  if (!ids.size) return
  const auth = { token: credentials.token!, teamId: credentials.teamId!, projectId: credentials.projectId! }
  for (const name of ids) {
    try { const sandbox = await Sandbox.get({ name, ...auth }); await sandbox.delete({ deleteOrphanSnapshots: true }) } catch (error) { if (!vercelInstanceGone(error)) throw vercelError(error) }
    try { await Sandbox.get({ name, ...auth }); throw new Error('Test sandbox still exists after cleanup') } catch (error) { if (!vercelInstanceGone(error)) throw error }
  }
  await recordVercelSandboxes(ids, true)
  console.log(`Vercel cleanup verified with SDK: ${ids.size} test sandbox(s) absent; 0 running`)
}
