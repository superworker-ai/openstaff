import { pathToFileURL } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
import { startServer } from './app.js'
import { runDoctor } from './doctor.js'

export * from './app.js'
export * from './agent/models.js'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.NODE_ENV === 'production') {
    const doctor = await runDoctor()
    for (const item of doctor.results.filter((result) => !result.hard && !result.ok)) console.warn(`${item.name}: warning (${item.detail})`)
    if (!doctor.ok) { for (const item of doctor.results.filter((result) => result.hard && !result.ok)) console.error(`${item.name}: ${item.detail}`); process.exit(1) }
  }
  const running = await startServer()
  const lock = path.join(running.config.dataDir, 'server.lock')
  await fs.writeFile(lock, String(process.pid), { flag: 'w', mode: 0o600 })
  console.log(`OpenStaff server listening on ${running.url}`)
  const shutdown = async () => {
    await running.stop()
    await fs.rm(lock, { force: true })
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
