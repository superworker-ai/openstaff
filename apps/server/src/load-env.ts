import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'

const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(import.meta.dirname, '../../../.env'),
]
const file = candidates.find((candidate) => fs.existsSync(candidate))
if (file) config({ path: file, quiet: true })
