import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectFs } from '../project-file-store.js'
import type { Run } from '../types.js'
import { discoverRuns, mergeExcludes, runArchivedFromRun } from './discover.js'

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
    await mkdir('outputs/group/bar-260502-150000')
    await mkdir('experiments/group/nested/baz-260503-080000')

    const dirs = await discoverRuns({
      name: 'p',
      root,
      include: [],
      exclude: [],
    })
    const ids = dirs.map((d) => d.replace(`${root}/`, ''))
    expect(ids.sort()).toEqual(
      [
        'logs/foo-260501-100000',
        'outputs/group/bar-260502-150000',
        'experiments/group/nested/baz-260503-080000',
      ].sort(),
    )
  })

  it('never enumerates the project root or unrelated directories', async () => {
    await mkdir('logs/keep-260501-100000')
    await mkdir('other/nested/skip-260502-100000')
    await mkdir('root-run-260503-100000')
    const native = projectFs.readdir.bind(projectFs)
    const spy = vi.spyOn(projectFs, 'readdir').mockImplementation((async (
      target: string,
      options: unknown,
    ) => {
      if (target === root || target.startsWith(join(root, 'other'))) {
        throw new Error('Unrelated project traversal')
      }
      return native(target as never, options as never)
    }) as never)
    try {
      expect(await discoverRuns({ name: 'p', root, include: [], exclude: [] })).toEqual([
        join(root, 'logs/keep-260501-100000'),
      ])
      expect(spy.mock.calls.map(([path]) => path)).toEqual([join(root, 'logs')])
    } finally {
      spy.mockRestore()
    }
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
    await mkdir('logs/.git/foo-260501-100000')
    await mkdir('outputs/node_modules/bar-260502-100000')
    await mkdir('experiments/__pycache__/baz-260503-100000')
    await mkdir('logs/keep-260504-100000')

    const dirs = await discoverRuns({ name: 'p', root, include: [], exclude: [] })
    expect(dirs).toHaveLength(1)
    expect(dirs[0]!.endsWith('keep-260504-100000')).toBe(true)
  })

  it('appends user excludes to defaults', async () => {
    await mkdir('logs/keep-260501-100000')
    await mkdir('logs/dist/skip-260502-100000')

    const dirs = await discoverRuns({
      name: 'p',
      root,
      include: [],
      exclude: ['dist'],
    })
    expect(dirs).toHaveLength(1)
    expect(dirs[0]!.endsWith('keep-260501-100000')).toBe(true)
  })

  it('records a run and never descends into its outputs', async () => {
    await mkdir('logs/outer-260501-100000/outputs/inner-260502-100000')
    await mkdir('logs/outer-260501-100000/checkpoints')

    const dirs = await discoverRuns({ name: 'p', root, include: [], exclude: [] })
    expect(dirs).toEqual([join(root, 'logs/outer-260501-100000')])
  })

  it('skips dot directories and does not follow directory symlinks', async () => {
    await mkdir('logs/keep-260501-100000')
    await mkdir('logs/.hidden/skip-260502-100000')
    await fs.symlink(join(root, 'logs'), join(root, 'outputs'), 'dir')

    const dirs = await discoverRuns({ name: 'p', root, include: [], exclude: [] })
    expect(dirs).toEqual([join(root, 'logs/keep-260501-100000')])
  })

  it('returns empty for empty root', async () => {
    const dirs = await discoverRuns({ name: 'p', root, include: [], exclude: [] })
    expect(dirs).toEqual([])
  })

  it('keeps one failed listing local and still returns every reachable run', async () => {
    // 40 sibling subtrees exceed the walk's in-flight listing ceiling, so a
    // leaked slot deadlocks and a rejected sibling listing must not abort the
    // walk or drop the runs its siblings own.
    const pad = (index: number): string => String(index).padStart(2, '0')
    for (let index = 0; index < 40; index += 1) {
      await mkdir(`logs/t${pad(index)}/nested/run${pad(index)}-260501-100000`)
    }
    const realReaddir = projectFs.readdir.bind(projectFs)
    const spy = vi.spyOn(projectFs, 'readdir').mockImplementation((async (
      target: string,
      options: unknown,
    ) => {
      if (/\/t\d*[02468]\/nested$/.test(target)) {
        const error: NodeJS.ErrnoException = new Error(`EACCES: ${target}`)
        error.code = 'EACCES'
        throw error
      }
      return await realReaddir(target as never, options as never)
    }) as never)

    try {
      const dirs = await discoverRuns({ name: 'p', root, include: [], exclude: [] })
      expect(dirs).toEqual(
        Array.from({ length: 40 }, (_, index) => index)
          .filter((index) => index % 2 === 1)
          .map((index) => join(root, `logs/t${pad(index)}/nested/run${pad(index)}-260501-100000`))
          .sort(),
      )
    } finally {
      spy.mockRestore()
    }
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

describe('runArchivedFromRun (v4 archive resolver)', () => {
  function makeRun(opts: {
    runDir: string
    archived: boolean
    /** Simulate a README that never declared `archived:` at all. */
    archivedKeyAbsent?: boolean
  }): Run {
    return {
      id: 'foo-260513-100000',
      project: 'p',
      path: opts.runDir,
      mtime: 0,
      readmeMtime: 0,
      hasReadme: true,
      frontMatter: {
        id: 'foo-260513-100000',
        name: 'foo',
        project: 'p',
        status: 'FINISHED',
        createdAt: '',
        experiment: null,
        updatedAt: '',
        finishedAt: null,
        host: null,
        pid: null,
        gpus: [],
        entry: '',
        command: '',
        wandb: null,
        hypotheses: [],
        tags: [],
        archived: opts.archived,
        deprecated: false,
      },
      sections: {
        motivation: null,
        setup: null,
        method: null,
        result: null,
        conclusion: null,
        caveats: null,
        artifacts: [],
        newHypotheses: null,
      },
      warnings: [],
      warningsRaw: null,
      body: '',
      parseErrors: [],
      parseWarnings: [],
      frontMatterKeys: opts.archivedKeyAbsent
        ? ['id', 'name', 'status', 'created_at']
        : ['id', 'name', 'status', 'created_at', 'archived'],
    }
  }

  it('returns frontmatter value when the field is present (true)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-archived-'))
    try {
      const run = makeRun({ runDir: dir, archived: true })
      expect(await runArchivedFromRun(run)).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns frontmatter value when the field is present (false)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-archived-'))
    try {
      const run = makeRun({ runDir: dir, archived: false })
      expect(await runArchivedFromRun(run)).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to sidecar when the README never declared `archived`', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-archived-'))
    try {
      await fs.writeFile(join(dir, '.archived'), '', 'utf8')
      const run = makeRun({
        runDir: dir,
        archived: false, // parser default when the key is absent
        archivedKeyAbsent: true,
      })
      expect(await runArchivedFromRun(run)).toBe(true)
      // Sidecar fallback ALSO surfaces a LEGACY_ARCHIVE_SIDECAR warning.
      expect(run.parseWarnings.some((w) => w.message.startsWith('LEGACY_ARCHIVE_SIDECAR'))).toBe(
        true,
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('frontmatter wins over sidecar when both are present (false frontmatter, true sidecar)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-archived-'))
    try {
      await fs.writeFile(join(dir, '.archived'), '', 'utf8')
      const run = makeRun({ runDir: dir, archived: false })
      expect(await runArchivedFromRun(run)).toBe(false)
      // But the inconsistency surfaces a LEGACY_ARCHIVE_SIDECAR warning.
      expect(run.parseWarnings.some((w) => w.message.startsWith('LEGACY_ARCHIVE_SIDECAR'))).toBe(
        true,
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not surface LEGACY_ARCHIVE_SIDECAR when no sidecar exists', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-archived-'))
    try {
      const run = makeRun({ runDir: dir, archived: false })
      expect(await runArchivedFromRun(run)).toBe(false)
      expect(run.parseWarnings.some((w) => w.message.startsWith('LEGACY_ARCHIVE_SIDECAR'))).toBe(
        false,
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
