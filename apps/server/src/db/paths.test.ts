import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { adoptLegacyDatabase, resolveDatabasePath } from './paths.js'

let directory: string
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openstaff-db-paths-')) })
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })

const files = async () => (await fs.readdir(directory)).sort()

it('resolve: uses openstaff.db in a fresh data directory', () => {
  expect(resolveDatabasePath(directory)).toBe(path.join(directory, 'openstaff.db'))
})

it('resolve: uses the legacy database when it is the only database present', async () => {
  await fs.writeFile(path.join(directory, 'superworkers.db'), '')
  expect(resolveDatabasePath(directory)).toBe(path.join(directory, 'superworkers.db'))
})

it('resolve: prefers openstaff.db when both databases are present', async () => {
  await fs.writeFile(path.join(directory, 'openstaff.db'), '')
  await fs.writeFile(path.join(directory, 'superworkers.db'), '')
  expect(resolveDatabasePath(directory)).toBe(path.join(directory, 'openstaff.db'))
})

it('adopt: creates nothing in a fresh data directory', async () => {
  const logs: string[] = []
  expect(adoptLegacyDatabase(directory, (m) => logs.push(m))).toBe(path.join(directory, 'openstaff.db'))
  expect(await files()).toEqual([])
  expect(logs).toEqual([])
})

it('adopt: renames the legacy database and its sidecars to openstaff.db', async () => {
  await fs.writeFile(path.join(directory, 'superworkers.db'), 'data')
  await fs.writeFile(path.join(directory, 'superworkers.db-wal'), 'wal')
  const logs: string[] = []
  expect(adoptLegacyDatabase(directory, (m) => logs.push(m))).toBe(path.join(directory, 'openstaff.db'))
  expect(await files()).toEqual(['openstaff.db', 'openstaff.db-wal'])
  expect(await fs.readFile(path.join(directory, 'openstaff.db'), 'utf8')).toBe('data')
  expect(logs).toHaveLength(1)
  expect(logs[0]).toContain('Renamed superworkers.db to openstaff.db')
})

it('adopt: keeps both files and warns when both databases exist', async () => {
  await fs.writeFile(path.join(directory, 'openstaff.db'), 'new')
  await fs.writeFile(path.join(directory, 'superworkers.db'), 'old')
  const logs: string[] = []
  expect(adoptLegacyDatabase(directory, (m) => logs.push(m))).toBe(path.join(directory, 'openstaff.db'))
  expect(await files()).toEqual(['openstaff.db', 'superworkers.db'])
  expect(logs).toHaveLength(1)
  expect(logs[0]).toContain('Both openstaff.db and superworkers.db exist')
})
