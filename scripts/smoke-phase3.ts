import fs from 'node:fs/promises'
import path from 'node:path'

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(import.meta.dirname, '../data/playwright')
process.env.COMPUTER_DRIVER = 'local'
const { browserSmoke } = await import('../apps/server/src/test/browser-smoke.js')
const dataRoot = path.resolve(import.meta.dirname, '../data')
await fs.mkdir(dataRoot, { recursive: true })
const directory = await fs.mkdtemp(path.join(dataRoot, 'phase3-smoke-'))
try { console.log(JSON.stringify(await browserSmoke(directory), null, 2)); console.log('Server stopped. Screenshot retained in the temporary DATA_DIR for inspection.') }
catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error }
