// Listing-count contract for the Run walk (`bounded-run-discovery`).
//
// The walk runs against an in-memory tree served through `projectFs`, so the
// number of directory listings is exact and independent of the host
// filesystem. Each Run entry directory (`logs/`, `outputs/`) holds 200
// non-Run directories with 50 children each and 100 Run directories with a
// configurable number of children.

import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectFs } from '../project-file-store.js'
import { discoverRuns } from './discover.js'

const ROOT = '/virtual/project'
const ENTRIES = ['logs', 'outputs']
const NON_RUN_DIRS = 200
const NON_RUN_CHILDREN = 50
const RUN_DIRS = 100

type Tree = Map<string, string[]>

function buildTree(runChildren: number): Tree {
  const tree: Tree = new Map([[ROOT, ENTRIES]])
  for (const entry of ENTRIES) {
    const base = join(ROOT, entry)
    const names: string[] = []
    for (let i = 0; i < NON_RUN_DIRS; i += 1) {
      const name = `group-${i}`
      names.push(name)
      const children = Array.from({ length: NON_RUN_CHILDREN }, (_, c) => `part-${c}`)
      tree.set(join(base, name), children)
      for (const child of children) tree.set(join(base, name, child), [])
    }
    for (let i = 0; i < RUN_DIRS; i += 1) {
      const name = `run${i}-260901-${String(100000 + i)}`
      names.push(name)
      // Run contents include a Run-shaped name that must never be discovered.
      const children = Array.from({ length: runChildren }, (_, c) =>
        c === 0 ? 'nested-260901-090000' : `ckpt-${c}`,
      )
      tree.set(join(base, name), children)
      for (const child of children) tree.set(join(base, name, child), [])
    }
    tree.set(base, names)
  }
  return tree
}

function dirent(name: string) {
  return { name, isDirectory: () => true, isSymbolicLink: () => false, isFile: () => false }
}

/** Serve `tree` through projectFs and return the list of listed paths. */
function serve(tree: Tree): string[] {
  const listed: string[] = []
  vi.spyOn(projectFs, 'readdir').mockImplementation((async (target: string) => {
    listed.push(target)
    const names = tree.get(target)
    if (!names) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return names.map(dirent)
  }) as never)
  vi.spyOn(projectFs, 'lstat').mockImplementation((async (target: string) => {
    if (!tree.has(target)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return { isDirectory: () => true, isSymbolicLink: () => false }
  }) as never)
  return listed
}

const project = { name: 'p', root: ROOT, include: [], exclude: [] }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('discoverRuns listing count', () => {
  it('never lists a Run-shaped directory, so listings do not grow with Run contents', async () => {
    const small = serve(buildTree(20))
    const foundSmall = await discoverRuns(project)
    vi.restoreAllMocks()
    const large = serve(buildTree(40))
    const foundLarge = await discoverRuns(project)

    const expected = ENTRIES.length * (1 + NON_RUN_DIRS + NON_RUN_DIRS * NON_RUN_CHILDREN)
    expect(small).toHaveLength(expected)
    expect(large).toHaveLength(expected)
    expect(foundSmall).toHaveLength(ENTRIES.length * RUN_DIRS)
    expect(foundLarge).toEqual(foundSmall)
    expect(small.some((path) => /-\d{6}-\d{6}/.test(path))).toBe(false)
    expect(foundSmall.some((path) => path.endsWith('nested-260901-090000'))).toBe(false)
  })

  it('run_depth 1 lists exactly the Run entry directories', async () => {
    const listed = serve(buildTree(20))
    const found = await discoverRuns({ ...project, runDepth: 1 })
    expect(listed).toHaveLength(ENTRIES.length)
    expect(found).toHaveLength(ENTRIES.length * RUN_DIRS)
  })

  it('run_depth 2 lists entry directories plus one level of non-Run children', async () => {
    const tree = buildTree(20)
    // A Run one level below a non-Run directory is in reach at depth 2 only.
    tree.get(join(ROOT, 'logs', 'group-0'))!.push('deep-260901-120000')
    tree.set(join(ROOT, 'logs', 'group-0', 'deep-260901-120000'), [])
    const listed = serve(tree)
    const found = await discoverRuns({ ...project, runDepth: 2 })
    expect(listed).toHaveLength(ENTRIES.length * (1 + NON_RUN_DIRS))
    expect(found).toHaveLength(ENTRIES.length * RUN_DIRS + 1)
    vi.restoreAllMocks()
    serve(tree)
    expect(await discoverRuns({ ...project, runDepth: 1 })).toHaveLength(ENTRIES.length * RUN_DIRS)
  })
})
