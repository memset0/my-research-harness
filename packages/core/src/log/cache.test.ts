import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadCache, saveCache } from './cache.js'
import { LineIndex } from './line-index.js'

let workDir: string
let cacheDir: string

beforeEach(async () => {
  workDir = await fs.mkdtemp(join(tmpdir(), 'memon-cache-'))
  cacheDir = await fs.mkdtemp(join(tmpdir(), 'memon-cachestore-'))
})

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true })
  await fs.rm(cacheDir, { recursive: true, force: true })
})

async function writeFile(name: string, content: string): Promise<string> {
  const p = join(workDir, name)
  await fs.writeFile(p, content)
  return p
}

describe('cache', () => {
  it('saves and reloads an equivalent index', async () => {
    const path = await writeFile('a.log', 'line1\nline2\nline3\n')
    const idx = await LineIndex.build(path, { anchorEvery: 2 })

    await saveCache(idx, { dir: cacheDir })
    const loaded = await loadCache(path, { dir: cacheDir })
    expect(loaded).not.toBeNull()
    expect(loaded!.totalLines).toBe(idx.totalLines)
    expect(loaded!.size).toBe(idx.size)
    // Verify range works on the cache-loaded index
    const r = await loaded!.range(3, 3)
    expect(r.map((l) => l.text)).toEqual(['line1', 'line2', 'line3'])
  })

  it('returns null when no cache exists', async () => {
    const path = await writeFile('a.log', 'x\n')
    expect(await loadCache(path, { dir: cacheDir })).toBeNull()
  })

  it('rejects stale cache (mtime/size advanced)', async () => {
    const path = await writeFile('a.log', 'one\ntwo\n')
    const idx = await LineIndex.build(path)
    await saveCache(idx, { dir: cacheDir })

    // Mutate the underlying file
    await fs.appendFile(path, 'three\n')

    expect(await loadCache(path, { dir: cacheDir })).toBeNull()
  })
})
