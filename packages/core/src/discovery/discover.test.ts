import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

describe('runArchivedFromRun (v4 archive resolver)', () => {
  function makeRun(opts: {
    runDir: string
    archived: boolean
    parseWarnings?: { message: string }[]
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
      parseWarnings: (opts.parseWarnings ?? []).map((w) => ({ ...w, severity: 'warning' as const })),
    }
  }

  it('returns frontmatter value when the field is present (true)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-archived-'))
    try {
      const run = makeRun({ runDir: dir, archived: true })
      expect(runArchivedFromRun(run)).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns frontmatter value when the field is present (false)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-archived-'))
    try {
      const run = makeRun({ runDir: dir, archived: false })
      expect(runArchivedFromRun(run)).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to sidecar when MISSING_ARCHIVED_FIELD warning is present', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-archived-'))
    try {
      await fs.writeFile(join(dir, '.archived'), '', 'utf8')
      const run = makeRun({
        runDir: dir,
        archived: false, // parser default when field missing
        parseWarnings: [{ message: 'MISSING_ARCHIVED_FIELD: ...' }],
      })
      expect(runArchivedFromRun(run)).toBe(true)
      // Sidecar fallback ALSO surfaces a LEGACY_ARCHIVE_SIDECAR warning.
      expect(run.parseWarnings.some((w) => w.message.startsWith('LEGACY_ARCHIVE_SIDECAR'))).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('frontmatter wins over sidecar when both are present (false frontmatter, true sidecar)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-archived-'))
    try {
      await fs.writeFile(join(dir, '.archived'), '', 'utf8')
      const run = makeRun({ runDir: dir, archived: false })
      expect(runArchivedFromRun(run)).toBe(false)
      // But the inconsistency surfaces a LEGACY_ARCHIVE_SIDECAR warning.
      expect(run.parseWarnings.some((w) => w.message.startsWith('LEGACY_ARCHIVE_SIDECAR'))).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not surface LEGACY_ARCHIVE_SIDECAR when no sidecar exists', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-archived-'))
    try {
      const run = makeRun({ runDir: dir, archived: false })
      expect(runArchivedFromRun(run)).toBe(false)
      expect(run.parseWarnings.some((w) => w.message.startsWith('LEGACY_ARCHIVE_SIDECAR'))).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
