import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { createId } from '@openstaff/shared'
import type { Database } from '../db/index.js'
import { plugins } from '../db/schema.js'
import type { Secrets } from '../secrets.js'
import { loadPlugin } from './loader.js'
import { CursorMarketplace, marketplaceLocation } from './marketplace.js'
import type { PluginRegistry } from './registry.js'

const execute = promisify(execFile)
export class PluginInstaller {
  private installing = false
  constructor(private readonly db: Database, private readonly dataDir: string, private readonly secrets: Secrets, private readonly registry: PluginRegistry, readonly marketplace = new CursorMarketplace()) {}

  async install(source: string) {
    if (this.installing) throw new Error('Another plugin installation is in progress')
    this.installing = true
    let temporary: string | undefined
    try {
      const temporaryRoot = path.join(this.dataDir, 'tmp')
      await fs.mkdir(temporaryRoot, { recursive: true })
      temporary = await fs.mkdtemp(path.join(temporaryRoot, 'plugin-'))
      let root: string
      let expectedName: string | undefined
      if (source.startsWith('path:')) {
        root = source.slice(5)
        if (!path.isAbsolute(root)) throw new Error('Local plugin source must be absolute')
      } else {
        let url: string, subdirectory = '', branch: string | undefined
        if (source.startsWith('marketplace:')) {
          expectedName = source.slice(12)
          const entry = (await this.marketplace.entries()).find((item) => item.name === expectedName)
          if (!entry) throw new Error('Marketplace plugin not found')
          const location = marketplaceLocation(this.marketplace.url)
          if (/^https?:/.test(entry.source)) [url = '', subdirectory = ''] = entry.source.split('#')
          else {
            if (!location.repository) throw new Error('Set PLUGIN_MARKETPLACE_REPO for this custom marketplace')
            url = location.repository; subdirectory = entry.source; branch = location.branch
          }
        } else if (source.startsWith('git:')) [url = '', subdirectory = ''] = source.slice(4).split('#')
        else throw new Error('Use marketplace:, git:, or path: source')
        if (!/^https?:\/\//.test(url)) throw new Error('Git sources must use an HTTP(S) URL')
        if (path.isAbsolute(subdirectory) || subdirectory.split('/').includes('..') || subdirectory.startsWith('-')) throw new Error('Invalid plugin subdirectory')
        const checkout = path.join(temporary, 'checkout')
        await execute('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', ...(branch ? ['--branch', branch] : []), url, checkout], { timeout: 120_000 })
        if (subdirectory && subdirectory !== '.') await execute('git', ['sparse-checkout', 'set', subdirectory], { cwd: checkout, timeout: 120_000 })
        else await execute('git', ['sparse-checkout', 'disable'], { cwd: checkout, timeout: 120_000 })
        root = path.join(checkout, subdirectory)
      }
      const loaded = await loadPlugin(root)
      const name = loaded.manifest.name
      if (expectedName && name !== expectedName) throw new Error('Marketplace name does not match the installed manifest')
      if ((await this.db.select().from(plugins).where(eq(plugins.name, name)))[0]) throw new Error('Plugin is already installed')
      const destination = path.join(this.dataDir, 'plugins', name)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      if (await fs.lstat(destination).then(() => true).catch(() => false)) throw new Error('Plugin destination already exists; inspect it before reinstalling')
      // Reject external symlinks before copying; never retain a reference to the source.
      const realRoot = await fs.realpath(root)
      await fs.cp(root, destination, { recursive: true, errorOnExist: true, force: false, dereference: true, filter: async (file) => {
        if (path.basename(file) === '.git') return false
        const real = await fs.realpath(file)
        if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) throw new Error('Plugin symlink escapes its root')
        return true
      } }).catch(async (error) => { await fs.rm(destination, { recursive: true, force: true }); throw error })
      const row = { id: createId('plugin'), name, source, rootPath: destination, manifest: loaded.manifest, enabled: true, variables: this.secrets.encrypt('{}'), installedAt: new Date().toISOString() }
      await this.db.insert(plugins).values(row).catch(async (error) => { await fs.rm(destination, { recursive: true, force: true }); throw error })
      await this.registry.rebuild()
      return row.id
    } finally { this.installing = false; if (temporary) await fs.rm(temporary, { recursive: true, force: true }) }
  }
  async remove(id: string): Promise<void> {
    const row = (await this.db.select().from(plugins).where(eq(plugins.id, id)))[0]
    if (!row) throw new Error('Plugin not found')
    if (row.rootPath !== path.join(this.dataDir, 'plugins', row.name)) throw new Error('Unexpected plugin root')
    await this.db.delete(plugins).where(eq(plugins.id, id))
    await this.registry.rebuild()
    await fs.rm(row.rootPath, { recursive: true, force: true })
  }
}
