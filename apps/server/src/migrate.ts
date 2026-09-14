import { readConfig } from './config.js'
import { createDatabase } from './db/index.js'

const handle = await createDatabase(readConfig().dataDir)
handle.close()
console.log('Database migrations complete')
