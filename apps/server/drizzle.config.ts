import { defineConfig } from 'drizzle-kit'
import { resolveDatabasePath } from './src/db/paths.js'

const dataDir = process.env.DATA_DIR ?? './data'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: resolveDatabasePath(dataDir) }
})
