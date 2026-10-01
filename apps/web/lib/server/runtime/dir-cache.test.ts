// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

describe('DirCache depth modes', () => {
  it('keeps depth 1 as the default and ignores nested files', async () => {
    const directory = join(root, 'reports')
    await fs.mkdir(join(directory, 'nested'), { recursive: true })
    await fs.writeFile(join(directory, 'R0001-report.md'), 'top')
    await fs.writeFile(join(directory, 'nested', 'R0002-hidden.md'), 'nested')
    const cache = makeCache([directory])
    await cache.warmup()
    expect(cache.paths()).toEqual([join(directory, 'R0001-report.md')])
    expect(cache.dirs()).toEqual([directory])
  })

  it('opts into child directories and bundle README files at depth 2', async () => {
    const directory = join(root, 'wiki')
    await fs.mkdir(join(directory, 'finding'), { recursive: true })
    await fs.mkdir(join(directory, 'showcase', 'W0002-bundle'), { recursive: true })
    await fs.writeFile(join(directory, 'finding', 'W0001-page.md'), 'page')
    await fs.writeFile(join(directory, 'showcase', 'W0002-bundle', 'README.md'), 'bundle')
    const cache = new DirCache<Meta>({
      name: 'wiki',
      dirs: [directory],
      depth: 2,
      fileNameRegex: /^W\d{4}-.+\.md$/,
      bundleDirNameRegex: /^W\d{4}-.+$/,
      bundleFileName: 'README.md',
      parseFile: (path, _content, mtime) => ({ path, mtime }),
    })
    await cache.warmup()
    expect(cache.paths().sort()).toEqual(
      [
        join(directory, 'finding', 'W0001-page.md'),
        join(directory, 'showcase', 'W0002-bundle', 'README.md'),
      ].sort(),
    )
    expect(cache.dirs()).toEqual(
      expect.arrayContaining([directory, join(directory, 'finding'), join(directory, 'showcase')]),
    )
  })
})
