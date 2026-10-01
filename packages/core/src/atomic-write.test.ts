import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AtomicWriteFs, writeFileAtomic } from './atomic-write.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-atomic-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('replaces the content and leaves no temp file', async () => {
    const path = join(dir, 'README.md')
    await fs.writeFile(path, 'old')
    await writeFileAtomic(path, 'new')
    expect(await fs.readFile(path, 'utf8')).toBe('new')
    expect(await fs.readdir(dir)).toEqual(['README.md'])
  })

  it('writes bytes, applies the mode and creates the parent on request', async () => {
    const path = join(dir, 'nested', 'state.csv')
    await writeFileAtomic(path, new Uint8Array([104, 105]), { mode: 0o600, mkdir: true })
    expect(await fs.readFile(path, 'utf8')).toBe('hi')
    expect((await fs.stat(path)).mode & 0o777).toBe(0o600)
  })

  it('fsyncs through a file handle when asked', async () => {
    const path = join(dir, 'synced.md')
    let synced = false
    const tracking: AtomicWriteFs = {
      ...fs,
      open: (async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args)
        const sync = handle.sync.bind(handle)
        handle.sync = async () => {
          synced = true
          await sync()
        }
        return handle
      }) as typeof fs.open,
    }
    await writeFileAtomic(path, 'x', { fsync: true, fs: tracking })
    expect(synced).toBe(true)
    expect(await fs.readFile(path, 'utf8')).toBe('x')
    expect(await fs.readdir(dir)).toEqual(['synced.md'])
  })

  it('removes the temp file and keeps the target when the rename fails', async () => {
    const path = join(dir, 'README.md')
    await fs.writeFile(path, 'old')
    const failing: AtomicWriteFs = {
      ...fs,
      rename: async () => {
        throw new Error('rename failed')
      },
    }
    await expect(writeFileAtomic(path, 'new', { fs: failing })).rejects.toThrow('rename failed')
    expect(await fs.readFile(path, 'utf8')).toBe('old')
    expect(await fs.readdir(dir)).toEqual(['README.md'])
  })
})
