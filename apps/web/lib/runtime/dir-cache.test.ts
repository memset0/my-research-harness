// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DirCache } from './dir-cache'

interface Meta {
  path: string
  mtime: number
}

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'dircache-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function makeCache(dirs: string[]) {
  return new DirCache<Meta>({
    name: 'test',
    dirs,
    fileNameRegex: /\.md$/,
    parseFile: (path, _content, mtime) => ({ path, mtime }),
  })
}

describe('DirCache addDir / removeDir / getAllList', () => {
  it('addDir scans + watches a new dir; getAllList aggregates across dirs', async () => {
    const a = join(root, 'a')
    const b = join(root, 'b')
    await fs.mkdir(a)
    await fs.mkdir(b)
    await fs.writeFile(join(a, 'x.md'), 'x')
    await fs.writeFile(join(b, 'y.md'), 'y')

    const cache = makeCache([a])
    await cache.warmup()
    expect(cache.getList(a)).toHaveLength(1)
    expect(cache.getAllList()).toHaveLength(1)

    await cache.addDir(b)
    expect(cache.dirs()).toContain(b)
    expect(cache.getList(b)).toHaveLength(1)
    expect(cache.getAllList()).toHaveLength(2)
  })

  it('addDir tolerates a directory that does not exist yet', async () => {
    const missing = join(root, 'later', 'code-review')
    const cache = makeCache([])
    await cache.addDir(missing)
    expect(cache.dirs()).toContain(missing)
    expect(cache.getList(missing)).toEqual([])
  })

  it('removeDir drops the dir and its entries from getAllList', async () => {
    const a = join(root, 'a')
    await fs.mkdir(a)
    await fs.writeFile(join(a, 'x.md'), 'x')
    const cache = makeCache([a])
    await cache.warmup()
    expect(cache.getAllList()).toHaveLength(1)

    cache.removeDir(a)
    expect(cache.dirs()).not.toContain(a)
    expect(cache.getAllList()).toHaveLength(0)
  })

  it('addDir is idempotent', async () => {
    const a = join(root, 'a')
    await fs.mkdir(a)
    await fs.writeFile(join(a, 'x.md'), 'x')
    const cache = makeCache([])
    await cache.addDir(a)
    await cache.addDir(a)
    expect(cache.dirs().filter((d) => d === a)).toHaveLength(1)
    expect(cache.getAllList()).toHaveLength(1)
  })
})
