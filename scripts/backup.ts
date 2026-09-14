import '../apps/server/src/load-env.js'
import { backup } from '../apps/server/src/backup.js'

const upload = process.argv.includes('--upload')
console.log(`Backup created${upload ? ' and uploaded' : ''}: ${await backup(upload)}`)
