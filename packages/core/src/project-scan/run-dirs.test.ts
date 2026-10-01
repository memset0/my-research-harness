import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunTargetIndex, resolveRunTarget } from './resolve-run.js'
import { scanProjectRoot } from './scan.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-run-dirs-'))
  for (const dir of ['logs/top-260901-090000', 'outputs/group/deep-260901-100000']) {
    await fs.mkdir(join(root, dir), { recursive: true })
    await fs.writeFile(join(root, dir, 'README.md'), '---\nstatus: FINISHED\n---\n')
  }
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('runDirs on bare-root callers', () => {
  it('scanProjectRoot expands the patterns and stays unbounded by default', async () => {
    const ids = async (runDirs?: string[]) =>
      (await scanProjectRoot(root, runDirs === undefined ? {} : { runDirs })).experiments
        .map((run) => run.id)
        .sort()
    expect(await ids()).toEqual(['deep-260901-100000', 'top-260901-090000'])
    expect(await ids(['logs/*', 'outputs/*/*'])).toEqual([
      'deep-260901-100000',
      'top-260901-090000',
    ])
    expect(await ids(['logs/*'])).toEqual(['top-260901-090000'])
  })

  it('base-name lookups use the patterns while path targets ignore them', async () => {
    const index = await RunTargetIndex.open(root, { runDirs: ['logs/*'] })
    expect(index.has('deep-260901-100000')).toBe(false)
    expect(await index.dir('deep-260901-100000')).toBeNull()
    expect(await index.dir('outputs/group/deep-260901-100000')).toBe(
      join(root, 'outputs/group/deep-260901-100000'),
    )
    expect((await index.read('outputs/group/deep-260901-100000'))?.id).toBe('deep-260901-100000')
    expect(await index.dir('outputs/group/missing-260901-100000')).toBeNull()

    expect(await resolveRunTarget(root, 'deep-260901-100000', { runDirs: ['logs/*'] })).toBeNull()
    expect((await resolveRunTarget(root, 'deep-260901-100000'))?.id).toBe('deep-260901-100000')
    expect(
      (await resolveRunTarget(root, 'outputs/group/deep-260901-100000', { runDirs: ['logs/*'] }))
        ?.id,
    ).toBe('deep-260901-100000')
  })
})
