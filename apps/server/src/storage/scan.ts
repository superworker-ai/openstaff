import type { Computer } from '../computer/types.js'
import { workspaceKey } from './types.js'

export interface ScannedFile { key: string; size: number; mtime: string; sha256?: string }
export interface ScanIndex { key: string; size: number; mtime: string | null }

// Linux uses one find inventory, then hashes only size/mtime changes. NUL framing
// preserves filenames containing tabs/newlines. Darwin is the Local/fake dev path.
const scanner = String.raw`
import json, os, stat, subprocess, sys
report, index_path = sys.argv[1:]
with open(index_path) as f:
    known = {x['key']: x for x in json.load(f)}
roots = [p for p in ('bots', 'skills', 'uploads') if os.path.lexists(p)]
rows = []
if sys.platform == 'darwin':
    for root in roots:
        for directory, dirs, files in os.walk(root, followlinks=False):
            for name in files:
                key = os.path.join(directory, name)
                info = os.lstat(key)
                if stat.S_ISREG(info.st_mode):
                    rows.append(dict(key=key, size=info.st_size, mtime=str(info.st_mtime_ns)))
elif roots:
    listing = subprocess.run(['find', *roots, '-type', 'f', '-printf', r'%s\t%T@\t%p\0'], check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout
    for entry in listing.split(b'\0'):
        if entry:
            size, mtime, key = entry.decode('utf-8').split('\t', 2)
            rows.append(dict(key=key, size=int(size), mtime=mtime))
changed = [r for r in rows if r['size'] <= 20 * 1024 ** 2 and (r['size'], r['mtime']) != (known.get(r['key'], {}).get('size'), known.get(r['key'], {}).get('mtime'))]
for start in range(0, len(changed), 100):
    batch = changed[start:start + 100]
    hashed = subprocess.run(['sha256sum', '-z', *[r['key'] for r in batch]], check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout
    hashes = hashed.split(b'\0')
    for row, line in zip(batch, hashes):
        row['sha256'] = line[:64].decode('ascii')
with open(report, 'x') as f:
    json.dump(rows, f)
print('hashed=' + str(len(changed)))
`

async function cleanup(computer: Computer, report: string, input: string) {
  try {
    if ((await computer.exec(`rm -f ${report} ${input}`)).code !== 0) throw new Error('Failed')
  } catch { throw new Error('Workspace inventory cleanup failed') }
}

export async function scanComputer(computer: Computer, indexed: ScanIndex[]): Promise<ScannedFile[]> {
  const base = `.openstaff/reconcile.${crypto.randomUUID()}`
  const report = `${base}.txt`, input = `${base}.json`
  await computer.mkdir('.openstaff')
  try {
    await computer.writeFile(input, JSON.stringify(indexed.map(({ key, size, mtime }) => ({ key, size, mtime }))))
    const result = await computer.exec(`python3 - ${report} ${input} <<'OPENSTAFF_SCAN' 2>/dev/null\n${scanner}\nOPENSTAFF_SCAN`, { timeoutMs: 120_000 })
    if (result.code !== 0) throw new Error('Workspace inventory failed')
    const parsed: unknown = JSON.parse(Buffer.from(await computer.readFileBytes(report)).toString('utf8'))
    if (!Array.isArray(parsed)) throw new Error('Invalid workspace inventory')
    return parsed.map((row: ScannedFile) => {
      const key = workspaceKey(row.key)
      if (!/^(bots|skills|uploads)\//.test(key) || !Number.isSafeInteger(row.size) || row.size < 0 || typeof row.mtime !== 'string'
        || (row.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(row.sha256))) throw new Error('Invalid workspace inventory')
      return { ...row, key }
    })
  } catch { throw new Error('Workspace inventory failed') }
  finally {
    // A separate cleanup exec is necessary after the uncapped file transfer.
    await cleanup(computer, report, input)
  }
}
