import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverRuns, mergeExcludes } from './discover.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-discover-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function mkdir(rel: string) {
  await fs.mkdir(join(root, rel), { recursive: true })
}

describe('discoverRuns', () => {
  it('finds experiment dirs at variable depths', async () => {
    await mkdir('logs/foo-260501-100000')
    await mkdir('sub/logs/bar-260502-150000')
    await mkdir('runs/baz-260503-080000')

    const dirs = await discoverRuns({
      name: 'p',
      root,
      include: [],
      exclude: [],
    })
    const ids = dirs.map((d) => d.replace(`${root}/`, ''))
    expect(ids.sort()).toEqual(
      ['logs/foo-260501-100000', 'runs/baz-260503-080000', 'sub/logs/bar-260502-150000'].sort(),
    )
  })

  it('does not match invalid name patterns', async () => {
    await mkdir('logs/foo-260501') // missing 2nd date segment
    await mkdir('logs/foo-2026-05-01-100000') // 4-digit year
    await mkdir('logs/valid-260501-100000')

    const dirs = await discoverRuns({ name: 'p', root, include: [], exclude: [] })
    expect(dirs).toHaveLength(1)
    expect(dirs[0]!.endsWith('valid-260501-100000')).toBe(true)
  })

  it('respects default excludes', async () => {
    await mkdir('.git/foo-260501-100000')
    await mkdir('node_modules/bar-260502-100000')
    await mkdir('__pycache__/baz-260503-100000')
    await mkdir('logs/keep-260504-100000')

    const dirs = await discoverRuns({ name: 'p', root, include: [], exclude: [] })
    expect(dirs).toHaveLength(1)
    expect(dirs[0]!.endsWith('keep-260504-100000')).toBe(true)
  })

  it('appends user excludes to defaults', async () => {
    await mkdir('logs/keep-260501-100000')
    await mkdir('dist/skip-260502-100000')

    const dirs = await discoverRuns({
      name: 'p',
      root,
      include: [],
      exclude: ['dist'],
    })
    expect(dirs).toHaveLength(1)
    expect(dirs[0]!.endsWith('keep-260501-100000')).toBe(true)
  })

  it('returns empty for empty root', async () => {
    const dirs = await discoverRuns({ name: 'p', root, include: [], exclude: [] })
    expect(dirs).toEqual([])
  })
})

describe('mergeExcludes', () => {
  it('prepends defaults and dedupes', () => {
    const merged = mergeExcludes(['dist', '.git', 'mock'])
    // .git is in defaults; expect it appears once, before user-only entries
    expect(merged.indexOf('.git')).toBeGreaterThanOrEqual(0)
    expect(merged.filter((e) => e === '.git').length).toBe(1)
    expect(merged).toContain('dist')
    expect(merged).toContain('mock')
  })
})
