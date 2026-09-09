// `memon wiki` CLI behaviour, scenario-for-scenario against the wiki-cli spec.
//
// Every case runs against a throwaway project root; the review / commit cases
// build a throwaway git repo, and the component cases talk to a stub central
// dashboard on 127.0.0.1 so no descriptor knowledge leaks into the CLI.

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseWikiFrontmatter } from '@memon/core'

import {
  runWikiBacklinks,
  runWikiCommit,
  runWikiComponentsLs,
  runWikiComponentsMigrate,
  runWikiComponentsShow,
  runWikiCreate,
  runWikiDelete,
  runWikiDeprecate,
  runWikiLint,
  runWikiKinds,
  runWikiLs,
  runWikiMigrateReport,
  runWikiMove,
  runWikiReviewDiff,
  runWikiReviewLog,
  runWikiReviewUnverify,
  runWikiReviewVerify,
  runWikiSet,
  runWikiShow,
  runWikiUndeprecate,
} from './wiki.js'

const execFileAsync = promisify(execFile)

describe('wiki kinds', () => {
  it('accepts a config-only kind through create, move and lint', async () => {
    const configurationPath = new URL('../../../core/dist/wiki/kinds.json', import.meta.url)
    const configuration = JSON.parse(await fs.readFile(configurationPath, 'utf8'))
    const ordinary = structuredClone(configuration.kinds.find((kind: { id: string }) => kind.id === 'note'))
    Object.assign(ordinary, { id: 'test-guide', order: 120, relatedKinds: [] })
    ordinary.en.purpose = 'Fixture purpose.'
    ordinary.en.examples = ['Fixture example.']
    configuration.kinds.push(ordinary)
    vi.resetModules()
    vi.doMock('../../../core/dist/wiki/kinds.json', () => ({ default: configuration }))
    try {
      const commands = await import('./wiki.js')
      const created = await runCapturing(() => commands.runWikiCreate({ cwd: root, kind: 'test-guide', slug: 'fixture', title: 'Fixture' }))
      expect(created.exitCode).toBeNull()
      const original = JSON.parse(created.stdout)
      const moved = await runCapturing(() => commands.runWikiMove({ cwd: root, page: original.id, target: 'note' }))
      expect(moved.exitCode).toBeNull()
      const restored = await runCapturing(() => commands.runWikiMove({ cwd: root, page: original.id, target: 'test-guide' }))
      expect(restored.exitCode).toBeNull()
      expect(JSON.parse(restored.stdout).id).toBe(original.id)
      const checked = await runCapturing(() => commands.runWikiLint({ cwd: root, strict: true }))
      expect(checked.exitCode).toBeNull()
      const explanation = await runCapturing(() => commands.runWikiKinds({ cwd: root, kind: 'test-guide', format: 'human' }))
      expect(explanation.stdout).toContain('Fixture purpose.')
      expect(explanation.stdout).toContain('Fixture example.')
    } finally {
      vi.doUnmock('../../../core/dist/wiki/kinds.json')
      vi.resetModules()
    }
  })

  it('lists and explains kinds without resolving a project', async () => {
    const listed = await runCapturing(() => runWikiKinds({ cwd: '/missing-project', format: 'json' }))
    const payload = JSON.parse(listed.stdout)
    expect(payload.kinds.map((kind: { id: string }) => kind.id)).toEqual(expect.arrayContaining(['initiative', 'catalog', 'note', 'roadmap']))
    const shown = await runCapturing(() => runWikiKinds({ cwd: '/missing-project', format: 'human', kind: 'initiative' }))
    expect(shown.stdout).toContain('推进计划')
    expect(shown.stdout).toContain('Status: none')
    expect(shown.stdout).toContain('May predate any Experiment')
    const unknown = await runCapturing(() => runWikiKinds({ cwd: '.', kind: 'workspace' }))
    expect(unknown.exitCode).toBe(2)
  })

  it.each(['initiative', 'catalog'])('creates and moves %s with stable identity and no scaffold', async (kind) => {
    const created = await runCapturing(() => runWikiCreate({ cwd: root, kind: 'note', slug: 'working-page', title: 'Working page', format: 'json' }))
    expect(created.exitCode).toBeNull()
    const original = JSON.parse(created.stdout)
    const moved = await runCapturing(() => runWikiMove({ cwd: root, page: original.id, target: kind, format: 'json' }))
    expect(moved.exitCode).toBeNull()
    const page = JSON.parse(moved.stdout)
    expect(page.id).toBe(original.id)
    expect(page.slug).toBe(original.slug)
    expect(page.status).toBeNull()
    const read = await fs.readFile(join(root, `docs/wiki/${kind}/${original.id}-working-page.md`), 'utf8')
    expect(read).not.toContain('\n## ')
    const checked = await runCapturing(() => runWikiLint({ cwd: root, strict: true, format: 'json' }))
    expect(checked.exitCode).toBeNull()
  })
})

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-wiki-cli-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

interface CapturedRun {
  exitCode: number | null
  stdout: string
  stderr: string
}

async function runCapturing(fn: () => Promise<unknown>): Promise<CapturedRun> {
  const realExit = process.exit
  const realStdout = process.stdout.write.bind(process.stdout)
  const realStderr = process.stderr.write.bind(process.stderr)
  const priorExitCode = process.exitCode
  process.exitCode = undefined
  let exitCode: number | null = null
  let stdout = ''
  let stderr = ''
  process.exit = ((code?: number) => {
    exitCode = code ?? 0
    throw new ExitCalled(exitCode)
  }) as typeof process.exit
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  try {
    await fn()
    if (typeof process.exitCode === 'number') exitCode = process.exitCode
  } catch (err) {
    if (!(err instanceof ExitCalled)) throw err
  } finally {
    process.exit = realExit
    process.stdout.write = realStdout
    process.stderr.write = realStderr
    process.exitCode = priorExitCode
  }
  return { exitCode, stdout, stderr }
}

/** Every command's default output is one JSON object; name the shape asserted on. */
function jsonAs<T>(text: string): T {
  return JSON.parse(text)
}

function errorOf(run: CapturedRun): { code: string; message: string } {
  return jsonAs<{ error: { code: string; message: string } }>(run.stderr).error
}

async function write(relative: string, content: string): Promise<void> {
  const target = join(root, relative)
  await fs.mkdir(join(target, '..'), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

async function readFile(relative: string): Promise<string> {
  return fs.readFile(join(root, relative), 'utf8')
}

async function pathExists(relative: string): Promise<boolean> {
  try {
    await fs.stat(join(root, relative))
    return true
  } catch {
    return false
  }
}

function page(frontmatter: string, body = '\n# Title\n\n## Claim\n\ntext\n'): string {
  return `---\n${frontmatter}\n---\n${body}`
}

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: root, encoding: 'utf8' })
  return stdout
}

async function initGit(): Promise<void> {
  await git('init', '-b', 'main')
  await git('config', 'user.email', 'test@example.invalid')
  await git('config', 'user.name', 'memon test')
  await git('config', 'commit.gpgsign', 'false')
}

/** One row per linted page: its id and the diagnostic codes it reported. */
function lintRows(run: CapturedRun): { id: string; codes: string[] }[] {
  return jsonAs<{ pages: { id: string; diagnostics: { code: string }[] }[] }>(run.stdout).pages.map(
    (entry) => ({ id: entry.id, codes: entry.diagnostics.map((diagnostic) => diagnostic.code) }),
  )
}

/**
 * Run `fn` with a recording stub as the only `git` on PATH, so git is both
 * unavailable and observable: `calls` lists the argv of every invocation.
 * `script` replaces the stub's body when a case needs specific git answers.
 */
async function withStubbedGit<T>(
  fn: () => Promise<T>,
  script = 'exit 1\n',
): Promise<{ result: T; calls: string[] }> {
  const bin = await fs.mkdtemp(join(tmpdir(), 'memon-wiki-git-stub-'))
  const log = join(bin, 'calls.log')
  await fs.writeFile(join(bin, 'git'), `#!/bin/sh\necho "$@" >> '${log}'\n${script}`, {
    mode: 0o755,
  })
  const priorPath = process.env.PATH
  process.env.PATH = bin
  try {
    const result = await fn()
    const recorded = await fs.readFile(log, 'utf8').catch(() => '')
    return { result, calls: recorded.split('\n').filter((line) => line !== '') }
  } finally {
    process.env.PATH = priorPath
    await fs.rm(bin, { recursive: true, force: true })
  }
}

const globals = (): { projectRoot: string; cwd: string } => ({ projectRoot: root, cwd: root })

// ---------- ls / show ----------

describe('memon wiki ls', () => {
  beforeEach(async () => {
    await write(
      'docs/wiki/finding/W0001-alpha.md',
      page(
        [
          'id: W0001',
          'kind: finding',
          'title: Alpha',
          'description: Why the C256 wrapper round-trips.',
          'status: TENTATIVE',
          'sources: [W0002]',
          'tags: [attention]',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-03T09:00:00+08:00"',
        ].join('\n'),
        '\n# Alpha\n\n## Claim\n\nMeasured in run alpha-260901-090000.\n\n## Evidence\n\ntext\n\n## Limits\n\ntext\n',
      ),
    )
    await write(
      'docs/wiki/showcase/W0002-beta/README.md',
      page(
        [
          'id: W0002',
          'kind: showcase',
          'title: Beta',
          'description: A bundle page.',
          'status: READY',
          'created_at: "2026-09-02T09:00:00+08:00"',
          'updated_at: "2026-09-04T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    await write(
      'docs/wiki/retro/W0003-gamma.md',
      page(
        [
          'id: W0003',
          'kind: retro',
          'title: Gamma',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
  })

  it('lists every discovered page, unknown kinds and bundles included', async () => {
    const run = await runCapturing(() => runWikiLs(globals()))
    const parsed = jsonAs<{ pages: { id: string; path: string }[] }>(run.stdout)
    expect(parsed.pages.map((entry) => entry.path)).toEqual([
      'docs/wiki/finding/W0001-alpha.md',
      'docs/wiki/showcase/W0002-beta/README.md',
      'docs/wiki/retro/W0003-gamma.md',
    ])
    // The list projection drops `mtime` (unstable) but keeps the rest.
    expect(parsed.pages[0]).not.toHaveProperty('mtime')
    expect(parsed.pages[0]).toMatchObject({
      id: 'W0001',
      kind: 'finding',
      description: 'Why the C256 wrapper round-trips.',
    })
    expect(parsed.pages[0]).not.toHaveProperty('stale')
  })

  it('prints the description under each page and suppresses it on demand', async () => {
    const shown = await runCapturing(() => runWikiLs({ ...globals(), format: 'human' }))
    expect(shown.stdout).toContain('    Why the C256 wrapper round-trips.')
    expect(shown.stdout).toContain('W0003  docs/wiki/retro/W0003-gamma.md')
    // Gamma has no description, so its line is the last one.
    expect(shown.stdout.trimEnd().split('\n').at(-1)).toContain('W0003')

    const hidden = await runCapturing(() =>
      runWikiLs({ ...globals(), format: 'human', description: false }),
    )
    expect(hidden.stdout).not.toContain('Why the C256 wrapper round-trips.')
  })

  it('renders one markdown table per kind', async () => {
    const run = await runCapturing(() => runWikiLs({ ...globals(), format: 'markdown' }))
    expect(run.stdout).toContain('## finding')
    expect(run.stdout).toContain('| id | path | status | updated_at | title | description |')
    expect(run.stdout).toContain('| W0003 | `docs/wiki/retro/W0003-gamma.md` |')
  })

  it('combines --kind and --status conjunctively', async () => {
    for (const [id, slug, status] of [
      ['W0011', 'one', 'OPEN'],
      ['W0012', 'two', 'OPEN'],
      ['W0013', 'three', 'RESOLVED'],
    ] as const) {
      await write(
        `docs/wiki/bottleneck/${id}-${slug}.md`,
        page(
          [
            `id: ${id}`,
            'kind: bottleneck',
            `title: ${slug}`,
            `status: ${status}`,
            'created_at: "2026-09-01T09:00:00+08:00"',
            'updated_at: "2026-09-01T09:00:00+08:00"',
          ].join('\n'),
        ),
      )
    }
    const run = await runCapturing(() =>
      runWikiLs({ ...globals(), kind: 'bottleneck', status: 'OPEN' }),
    )
    const parsed = jsonAs<{ pages: { id: string }[] }>(run.stdout)
    expect(parsed.pages.map((entry) => entry.id)).toEqual(['W0011', 'W0012'])
  })

  it('--source matches normalized declared tokens without resolving the target', async () => {
    await write(
      'docs/wiki/note/W0010-external.md',
      page(
        [
          'id: W0010',
          'kind: note',
          'title: External',
          'sources: [E0099-missing-experiment/V0004]',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    const run = await runCapturing(() => runWikiLs({ ...globals(), source: 'E0099' }))
    const parsed = jsonAs<{ pages: { id: string }[] }>(run.stdout)
    expect(parsed.pages.map((entry) => entry.id)).toEqual(['W0010'])
  })

  it('rejects an unknown --format', async () => {
    const format = await runCapturing(() => runWikiLs({ ...globals(), format: 'yaml' }))
    expect(format.exitCode).toBe(2)
    expect(errorOf(format).code).toBe('BAD_REQUEST')
  })

})

describe('memon wiki show and addressing', () => {
  beforeEach(async () => {
    await write(
      'docs/wiki/finding/W0004-vsa-debt.md',
      page(
        [
          'id: W0004',
          'kind: finding',
          'title: VSA common-path debt',
          'status: TENTATIVE',
          'sources: [W0004]',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
        '\n# VSA common-path debt\n\n## Claim\n\nSeen in E0001.\n',
      ),
    )
  })

  it('addresses the same page by slug and by canonical id', async () => {
    const bySlug = await runCapturing(() => runWikiShow({ ...globals(), page: 'vsa-debt' }))
    const byId = await runCapturing(() => runWikiShow({ ...globals(), page: 'W0004' }))
    expect(bySlug.stdout).toBe(byId.stdout)
    expect(JSON.parse(bySlug.stdout)).toMatchObject({ id: 'W0004', slug: 'vsa-debt' })
  })

  it('lists diagnostics alongside the content', async () => {
    const run = await runCapturing(() => runWikiShow({ ...globals(), page: 'W0004' }))
    const parsed = jsonAs<{
      diagnostics: { code: string }[]
      content: string
    }>(run.stdout)
    // Recommended `finding` sections Evidence / Limits are absent.
    expect(parsed.diagnostics.map((entry) => entry.code)).toContain('WIKI_MISSING_SECTION')
    expect(parsed.content).toContain('---\nid: W0004')
  })

  it('--body-only drops the frontmatter', async () => {
    const json = await runCapturing(() =>
      runWikiShow({ ...globals(), page: 'W0004', bodyOnly: true }),
    )
    expect((jsonAs<{ content: string }>(json.stdout)).content).not.toContain('id: W0004')

    const human = await runCapturing(() =>
      runWikiShow({ ...globals(), page: 'W0004', bodyOnly: true, format: 'human' }),
    )
    expect(human.stdout.startsWith('\n# VSA common-path debt')).toBe(true)
  })

  it('--body-only never scans source-target directories', async () => {
    await Promise.all([
      fs.mkdir(join(root, 'logs'), { recursive: true }),
      fs.mkdir(join(root, 'docs/experiments'), { recursive: true }),
      fs.mkdir(join(root, 'docs/reports'), { recursive: true }),
    ])
    const readdir = vi.spyOn(fs, 'readdir')
    const run = await runCapturing(() =>
      runWikiShow({ ...globals(), page: 'W0004', bodyOnly: true, format: 'human' }),
    )
    expect(run.exitCode).toBeNull()
    const visited = readdir.mock.calls.map(([path]) => String(path))
    expect(visited.some((path) => /(?:logs|docs\/experiments|docs\/reports)$/.test(path))).toBe(
      false,
    )
  })

  it('exits 4 for an unknown page and 2 for an unpadded id', async () => {
    const unknown = await runCapturing(() => runWikiShow({ ...globals(), page: 'nope' }))
    expect(unknown.exitCode).toBe(4)
    expect(errorOf(unknown).code).toBe('NOT_FOUND')

    const unpadded = await runCapturing(() => runWikiShow({ ...globals(), page: 'W7' }))
    expect(unpadded.exitCode).toBe(2)
    expect(errorOf(unpadded).code).toBe('BAD_REQUEST')
  })
})

// ---------- create / move / set ----------

describe('memon wiki create', () => {
  it('writes a full template and reports the new summary', async () => {
    const run = await runCapturing(() =>
      runWikiCreate({
        ...globals(),
        kind: 'finding',
        slug: 'vsa-debt',
        title: 'VSA common-path debt',
        description: 'Common path pays for VSA even when disabled.',
        status: 'VERIFIED',
        source: ['E0017'],
        tag: ['vsa'],
      }),
    )
    const summary = jsonAs<{
      id: string
      path: string
      absolutePath: string
    }>(run.stdout)
    expect(summary.id).toBe('W0001')
    expect(summary.path).toBe('docs/wiki/finding/W0001-vsa-debt.md')
    expect(summary).not.toHaveProperty('stale')
    expect(summary.absolutePath).toBe(join(root, summary.path))

    const content = await readFile(summary.path)
    expect(content).toContain('id: W0001')
    expect(content).toContain('kind: finding')
    expect(content).toContain('status: VERIFIED')
    expect(content).toContain('description: Common path pays for VSA even when disabled.')
    expect(content).toContain('- E0017')
    expect(content).toContain('# VSA common-path debt')
    for (const section of ['## Claim', '## Evidence', '## Limits']) {
      expect(content).toContain(section)
    }
  })

  it('allocates the next id above every existing page', async () => {
    await write(
      'docs/wiki/note/W0007-old.md',
      page(
        [
          'id: W0007',
          'kind: note',
          'title: Old',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    const run = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'note', slug: 'fresh', title: 'Fresh' }),
    )
    expect((jsonAs<{ id: string }>(run.stdout)).id).toBe('W0008')
  })

  it('defaults status to the kind vocabulary and requires --date for meeting', async () => {
    const created = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'question', slug: 'why', title: 'Why?' }),
    )
    expect((jsonAs<{ status: string }>(created.stdout)).status).toBe('OPEN')

    const missingDate = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'meeting', slug: 'weekly', title: 'Weekly' }),
    )
    expect(missingDate.exitCode).toBe(2)
    expect(errorOf(missingDate).message).toContain('--date')
    expect(await pathExists('docs/wiki/meeting/W0002-weekly.md')).toBe(false)

    const withDate = await runCapturing(() =>
      runWikiCreate({
        ...globals(),
        kind: 'meeting',
        slug: 'weekly',
        title: 'Weekly',
        date: '2026-05-04',
      }),
    )
    expect(withDate.exitCode).toBeNull()
    expect(await readFile('docs/wiki/meeting/W0002-weekly.md')).toContain('date: 2026-05-04')
  })

  it('creates a roadmap without status or fixed section scaffolding', async () => {
    const run = await runCapturing(() =>
      runWikiCreate({
        ...globals(),
        kind: 'roadmap',
        slug: 'research-plan',
        title: 'Research plan',
      }),
    )
    const summary = jsonAs<{
      id: string
      kind: string
      status: null
      path: string
    }>(run.stdout)
    expect(summary).toMatchObject({
      id: 'W0001',
      kind: 'roadmap',
      status: null,
      path: 'docs/wiki/roadmap/W0001-research-plan.md',
    })
    const content = await readFile(summary.path)
    expect(content).toContain('kind: roadmap')
    expect(content).not.toMatch(/^status:/m)
    expect(content).not.toMatch(/^## /m)
  })

  it('refuses a slug already used by another kind', async () => {
    await write(
      'docs/wiki/note/W0001-vsa-debt.md',
      page(
        [
          'id: W0001',
          'kind: note',
          'title: VSA debt',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    const run = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'finding', slug: 'vsa-debt', title: 'x' }),
    )
    expect(run.exitCode).toBe(9)
    expect(errorOf(run).code).toBe('CONFLICT')
    expect(await pathExists('docs/wiki/finding')).toBe(false)
  })

  it('rejects an unknown kind, a bad status, and the reserved code-review kind', async () => {
    const unknownKind = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'retro', slug: 'x', title: 'x' }),
    )
    expect(unknownKind.exitCode).toBe(2)

    const badStatus = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'finding', slug: 'x', title: 'x', status: 'NOPE' }),
    )
    expect(badStatus.exitCode).toBe(2)

    const reserved = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'code-review', slug: 'x', title: 't' }),
    )
    expect(reserved.exitCode).toBe(2)
    expect(errorOf(reserved).message).toContain('memon-write-code-review')
    expect(await pathExists('docs/wiki/code-review')).toBe(false)
  })

  it('--bundle creates the directory form', async () => {
    const run = await runCapturing(() =>
      runWikiCreate({
        ...globals(),
        kind: 'showcase',
        slug: 'explorer',
        title: 'Explorer',
        bundle: true,
      }),
    )
    const summary = jsonAs<{ path: string; format: string }>(run.stdout)
    expect(summary.path).toBe('docs/wiki/showcase/W0001-explorer/README.md')
    expect(summary.format).toBe('bundle')
  })
})

describe('memon wiki move', () => {
  beforeEach(async () => {
    await write(
      'docs/wiki/note/W0012-kernel-questions.md',
      page(
        [
          'id: W0012',
          'kind: note',
          'title: Kernel questions',
          'legacy_id: R0003',
          'owner: nobody',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
        '\n# Kernel questions\n\nbody\n',
      ),
    )
  })

  it('reclassifies a note, keeping id, created_at, and unknown keys', async () => {
    const run = await runCapturing(() =>
      runWikiMove({ ...globals(), page: 'W0012', target: 'question', status: 'OPEN' }),
    )
    const summary = jsonAs<{ oldPath: string; newPath: string; id: string }>(run.stdout)
    expect(summary.id).toBe('W0012')
    expect(summary.oldPath).toBe('docs/wiki/note/W0012-kernel-questions.md')
    expect(summary.newPath).toBe('docs/wiki/question/W0012-kernel-questions.md')

    const content = await readFile(summary.newPath)
    expect(content).toContain('kind: question')
    expect(content).toContain('status: OPEN')
    expect(content).toContain('legacy_id: R0003')
    expect(content).toContain('owner: nobody')
    // The YAML is re-dumped, so the timestamp loses its quotes but not its value.
    expect(content).toContain('created_at: 2026-09-01T09:00:00+08:00')
    expect(jsonAs<{ createdAt: string }>(run.stdout).createdAt).toBe('2026-09-01T09:00:00+08:00')
    expect(await pathExists('docs/wiki/note/W0012-kernel-questions.md')).toBe(false)
  })

  it('reclassifies a note as a statusless roadmap without changing its id or slug', async () => {
    const run = await runCapturing(() =>
      runWikiMove({ ...globals(), page: 'W0012', target: 'roadmap' }),
    )
    const summary = jsonAs<{
      id: string
      slug: string
      status: null
      newPath: string
    }>(run.stdout)
    expect(summary).toMatchObject({
      id: 'W0012',
      slug: 'kernel-questions',
      status: null,
      newPath: 'docs/wiki/roadmap/W0012-kernel-questions.md',
    })
    const content = await readFile(summary.newPath)
    expect(content).toContain('kind: roadmap')
    expect(content).not.toMatch(/^status:/m)
  })

  it('renames the slug when the target carries one', async () => {
    const run = await runCapturing(() =>
      runWikiMove({ ...globals(), page: 'W0012', target: 'question/kernel-abi', status: 'OPEN' }),
    )
    expect((jsonAs<{ newPath: string }>(run.stdout)).newPath).toBe(
      'docs/wiki/question/W0012-kernel-abi.md',
    )
  })

  it('refuses a status the target kind does not accept', async () => {
    await write(
      'docs/wiki/finding/W0013-verified.md',
      page(
        [
          'id: W0013',
          'kind: finding',
          'title: Verified finding',
          'status: VERIFIED',
          'sources: [E0001]',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    const before = await readFile('docs/wiki/finding/W0013-verified.md')
    const run = await runCapturing(() =>
      runWikiMove({ ...globals(), page: 'W0013', target: 'bottleneck' }),
    )
    expect(run.exitCode).toBe(2)
    expect(errorOf(run).code).toBe('BAD_REQUEST')
    expect(await readFile('docs/wiki/finding/W0013-verified.md')).toBe(before)
    expect(await pathExists('docs/wiki/bottleneck/W0013-verified.md')).toBe(false)
  })

  it('refuses a taken target slug and the reserved kind', async () => {
    await write(
      'docs/wiki/question/W0014-kernel-abi.md',
      page(
        [
          'id: W0014',
          'kind: question',
          'title: Already using the target slug',
          'status: OPEN',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    const conflict = await runCapturing(() =>
      runWikiMove({ ...globals(), page: 'W0012', target: 'question/kernel-abi', status: 'OPEN' }),
    )
    expect(conflict.exitCode).toBe(9)

    const reserved = await runCapturing(() =>
      runWikiMove({ ...globals(), page: 'W0012', target: 'code-review' }),
    )
    expect(reserved.exitCode).toBe(2)
  })
})

describe('memon wiki set', () => {
  const relative = 'docs/wiki/finding/W0001-vsa-debt.md'
  const body = '\n# VSA common-path debt\n\n## Claim\n\nSeen in E0001.\t trailing  \n'

  beforeEach(async () => {
    await write(
      relative,
      page(
        [
          'id: W0001',
          'kind: finding',
          'title: VSA common-path debt',
          'status: TENTATIVE',
          'sources: [E0001]',
          'tags: [vsa, debt]',
          'owner: nobody',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
        body,
      ),
    )
  })

  it('applies only the requested change, byte-preserving the body', async () => {
    const run = await runCapturing(() =>
      runWikiSet({ ...globals(), page: 'vsa-debt', status: 'RETRACTED' }),
    )
    expect(run.exitCode).toBeNull()
    const content = await readFile(relative)
    expect(content).toContain('status: RETRACTED')
    expect(content).toContain('owner: nobody')
    expect(content.endsWith(body)).toBe(true)
    expect(content).not.toContain('updated_at: "2026-09-01T09:00:00+08:00"')
    expect((jsonAs<{ status: string }>(run.stdout)).status).toBe('RETRACTED')
  })

  it('adds and removes sources and tags', async () => {
    const run = await runCapturing(() =>
      runWikiSet({
        ...globals(),
        page: 'vsa-debt',
        addSource: ['E9999-never-loaded/V0042'],
        rmSource: ['E0001'],
        addTag: ['perf'],
        rmTag: ['debt'],
      }),
    )
    const summary = jsonAs<{ sources: string[]; tags: string[] }>(run.stdout)
    expect(summary.sources).toEqual(['E9999-never-loaded/V0042'])
    expect(summary.tags).toEqual(['vsa', 'perf'])
    expect(await readFile(relative)).toContain('- E9999-never-loaded/V0042')
  })

  it('refuses a stale --expected-mtime and leaves the file alone', async () => {
    const before = await readFile(relative)
    const run = await runCapturing(() =>
      runWikiSet({ ...globals(), page: 'vsa-debt', addTag: ['x'], expectedMtime: 1 }),
    )
    expect(run.exitCode).toBe(9)
    expect(errorOf(run).code).toBe('CONFLICT')
    expect(await readFile(relative)).toBe(before)
  })

  it('requires at least one change flag and a valid status', async () => {
    const empty = await runCapturing(() => runWikiSet({ ...globals(), page: 'vsa-debt' }))
    expect(empty.exitCode).toBe(2)

    const badStatus = await runCapturing(() =>
      runWikiSet({ ...globals(), page: 'vsa-debt', status: 'OPEN' }),
    )
    expect(badStatus.exitCode).toBe(2)
  })
})

describe('memon wiki local file scope', () => {
  it('create, set, and ls never scan source-target directories', async () => {
    await Promise.all([
      fs.mkdir(join(root, 'logs'), { recursive: true }),
      fs.mkdir(join(root, 'docs/experiments'), { recursive: true }),
      fs.mkdir(join(root, 'docs/reports'), { recursive: true }),
    ])
    const readdir = vi.spyOn(fs, 'readdir')
    await runCapturing(() =>
      runWikiCreate({
        ...globals(),
        kind: 'note',
        slug: 'local-only',
        title: 'Local only',
        source: ['E9999-does-not-exist'],
      }),
    )
    await runCapturing(() =>
      runWikiSet({ ...globals(), page: 'local-only', addSource: ['H9999'] }),
    )
    await runCapturing(() => runWikiLs(globals()))

    const visited = readdir.mock.calls.map(([path]) => String(path))
    expect(visited.some((path) => /(?:logs|docs\/experiments|docs\/reports)$/.test(path))).toBe(
      false,
    )
  })
})

// ---------- lint ----------

describe('memon wiki lint', () => {
  it('exits 1 under --strict when an error diagnostic exists', async () => {
    await write(
      'docs/wiki/note/W0001-untitled.md',
      page(
        [
          'id: W0001',
          'kind: note',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
        '\ntext\n',
      ),
    )
    const lenient = await runCapturing(() => runWikiLint(globals()))
    expect(lenient.exitCode).toBeNull()
    expect(lenient.stdout).toContain('WIKI_TITLE_MISSING')

    const strict = await runCapturing(() => runWikiLint({ ...globals(), strict: true }))
    expect(strict.exitCode).toBe(1)
    const parsed = jsonAs<{
      pages: { diagnostics: { code: string }[] }[]
      summary: { errors: number }
    }>(strict.stdout)
    expect(parsed.summary.errors).toBeGreaterThan(0)
    expect(parsed.pages[0]!.diagnostics.map((entry) => entry.code)).toContain('WIKI_TITLE_MISSING')
  })

  it('reports project-level duplicate slugs on both pages', async () => {
    for (const [id, kind] of [
      ['W0001', 'note'],
      ['W0002', 'decision'],
    ] as const) {
      await write(
        `docs/wiki/${kind}/${id}-same.md`,
        page(
          [
            `id: ${id}`,
            `kind: ${kind}`,
            'title: Same',
            ...(kind === 'decision' ? ['status: ACCEPTED'] : []),
            'created_at: "2026-09-01T09:00:00+08:00"',
            'updated_at: "2026-09-01T09:00:00+08:00"',
          ].join('\n'),
        ),
      )
    }
    const run = await runCapturing(() => runWikiLint(globals()))
    const parsed = jsonAs<{ pages: { diagnostics: { code: string }[] }[] }>(run.stdout)
    expect(parsed.pages).toHaveLength(2)
    for (const entry of parsed.pages) {
      expect(entry.diagnostics.map((d) => d.code)).toContain('WIKI_SLUG_DUPLICATE')
    }
  })

  it('validates source syntax without checking target existence', async () => {
    await write(
      'docs/wiki/note/W0003-sources.md',
      page(
        [
          'id: W0003',
          'kind: note',
          'title: Sources',
          'sources: [E9999-missing/V0042, W9999, malformed/source]',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    const run = await runCapturing(() => runWikiLint({ ...globals(), page: 'sources' }))
    const diagnostics = jsonAs<{
      pages: { diagnostics: { code: string; message: string }[] }[]
    }>(run.stdout).pages[0]!.diagnostics
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WIKI_SOURCE_UNRESOLVED',
          message: expect.stringContaining('malformed/source'),
        }),
      ]),
    )
    expect(diagnostics.some((entry) => entry.message.includes('E9999-missing'))).toBe(false)
    expect(diagnostics.some((entry) => entry.message.includes('W9999'))).toBe(false)
  })

  it('lints only the addressed page when one is given', async () => {
    await write(
      'docs/wiki/note/W0001-a.md',
      page(
        [
          'id: W0001',
          'kind: note',
          'title: A',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    await write(
      'docs/wiki/note/W0002-b.md',
      page(
        [
          'id: W0002',
          'kind: note',
          'title: B',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    const run = await runCapturing(() => runWikiLint({ ...globals(), page: 'b' }))
    const parsed = jsonAs<{ pages: { id: string }[] }>(run.stdout)
    expect(parsed.pages.map((entry) => entry.id)).toEqual(['W0002'])
  })

  it('never spawns git for an ordinary command, a VERIFIED finding included', async () => {
    // No ordinary command makes a review claim, so a missing, slow, or hanging
    // git must not be reached at all — not even by a `status: VERIFIED` page.
    await write(
      'docs/wiki/note/W0001-a.md',
      page(
        [
          'id: W0001',
          'kind: note',
          'title: A',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    await write(
      'docs/wiki/finding/W0002-verified.md',
      page(
        [
          'id: W0002',
          'kind: finding',
          'title: Verified',
          'status: VERIFIED',
          'sources: [E0001]',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
        '\n# Verified\n\n## Claim\n\nE0001 shows it.\n',
      ),
    )

    const linted = await withStubbedGit(() => runCapturing(() => runWikiLint(globals())))
    expect(linted.calls).toEqual([])
    expect(lintRows(linted.result).map((row) => row.id).sort()).toEqual(['W0001', 'W0002'])
    expect(lintRows(linted.result).flatMap((row) => row.codes)).not.toContain(
      'WIKI_UNREVIEWED_VERIFIED',
    )

    const listed = await withStubbedGit(() => runCapturing(() => runWikiLs(globals())))
    expect(listed.calls).toEqual([])
    expect(
      jsonAs<{ pages: Record<string, unknown>[] }>(listed.result.stdout).pages[0],
    ).not.toHaveProperty('review')

    const shown = await withStubbedGit(() =>
      runCapturing(() => runWikiShow({ ...globals(), page: 'W0002' })),
    )
    expect(shown.calls).toEqual([])
    expect(jsonAs<Record<string, unknown>>(shown.result.stdout)).not.toHaveProperty('review')

    const backlinks = await withStubbedGit(() =>
      runCapturing(() => runWikiBacklinks({ ...globals(), artifact: 'E0001' })),
    )
    expect(backlinks.calls).toEqual([])
    expect(
      jsonAs<{ pages: Record<string, unknown>[] }>(backlinks.result.stdout).pages[0],
    ).not.toHaveProperty('reviewState')
  })

  it('reports a bundle `entry` missing from the page assets', async () => {
    await write(
      'docs/wiki/showcase/W0007-demo/README.md',
      page(
        [
          'id: W0007',
          'kind: showcase',
          'title: Demo',
          'status: READY',
          'entry: view.html',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    const run = await runCapturing(() => runWikiLint({ ...globals(), page: 'demo' }))
    expect(lintRows(run)[0]!.codes).toContain('WIKI_ENTRY_MISSING')
  })
})

// ---------- deprecate / delete ----------

describe('memon wiki deprecate and delete', () => {
  beforeEach(async () => {
    for (const [id, slug] of [
      ['W0004', 'old-claim'],
      ['W0012', 'new-claim'],
    ] as const) {
      await write(
        `docs/wiki/note/${id}-${slug}.md`,
        page(
          [
            `id: ${id}`,
            'kind: note',
            `title: ${slug}`,
            'created_at: "2026-09-01T09:00:00+08:00"',
            'updated_at: "2026-09-01T09:00:00+08:00"',
          ].join('\n'),
        ),
      )
    }
  })

  it('writes and removes the deprecation object and marks deprecated pages in ls', async () => {
    const run = await runCapturing(() =>
      runWikiDeprecate({
        ...globals(),
        page: 'W0004',
        reason: 'superseded',
        supersededBy: 'W0012',
      }),
    )
    const summary = jsonAs<{
      deprecated: { at: string; reason: string; superseded_by: string }
    }>(run.stdout)
    expect(summary.deprecated.reason).toBe('superseded')
    expect(summary.deprecated.superseded_by).toBe('W0012')
    expect(summary.deprecated.at).toMatch(/[+-]\d{2}:\d{2}$|Z$/)

    const listed = await runCapturing(() => runWikiLs({ ...globals(), format: 'human' }))
    expect(listed.stdout).toContain('[deprecated]')
    // Deprecated pages sort last within their kind.
    expect(listed.stdout.trimEnd().split('\n').at(-1)).toContain('W0004')

    const restored = await runCapturing(() =>
      runWikiUndeprecate({ ...globals(), page: 'W0004' }),
    )
    expect(jsonAs<{ deprecated: unknown }>(restored.stdout).deprecated).toBeNull()
    expect(await readFile('docs/wiki/note/W0004-old-claim.md')).not.toContain('deprecated:')
  })

  it('validates successor syntax without checking whether the page exists', async () => {
    const accepted = await runCapturing(() =>
      runWikiDeprecate({ ...globals(), page: 'W0004', reason: 'x', supersededBy: 'W9999' }),
    )
    expect(accepted.exitCode).toBeNull()
    expect(await readFile('docs/wiki/note/W0004-old-claim.md')).toContain(
      'superseded_by: W9999',
    )
  })

  it('refuses a bundle holding more than README.md without --force', async () => {
    await write(
      'docs/wiki/showcase/W0020-kernel-map/README.md',
      page(
        [
          'id: W0020',
          'kind: showcase',
          'title: Kernel map',
          'status: READY',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    await write('docs/wiki/showcase/W0020-kernel-map/views/index.html', '<p>x</p>\n')

    const refused = await runCapturing(() => runWikiDelete({ ...globals(), page: 'kernel-map' }))
    expect(refused.exitCode).toBe(2)
    expect(await pathExists('docs/wiki/showcase/W0020-kernel-map/README.md')).toBe(true)

    const forced = await runCapturing(() =>
      runWikiDelete({ ...globals(), page: 'kernel-map', force: true }),
    )
    expect(forced.exitCode).toBeNull()
    expect((jsonAs<{ removed: string[] }>(forced.stdout)).removed).toEqual([
      'docs/wiki/showcase/W0020-kernel-map',
    ])
    expect(await pathExists('docs/wiki/showcase/W0020-kernel-map')).toBe(false)
  })

  it('deletes a single-file page outright', async () => {
    const run = await runCapturing(() => runWikiDelete({ ...globals(), page: 'W0004' }))
    expect((jsonAs<{ removed: string[] }>(run.stdout)).removed).toEqual([
      'docs/wiki/note/W0004-old-claim.md',
    ])
    expect(await pathExists('docs/wiki/note/W0004-old-claim.md')).toBe(false)
  })
})

// ---------- backlinks / migrate-report ----------

describe('memon wiki backlinks', () => {
  it('lists every page citing an experiment, newest first', async () => {
    await write(
      'docs/wiki/finding/W0004-alpha.md',
      page(
        [
          'id: W0004',
          'kind: finding',
          'title: Alpha',
          'status: TENTATIVE',
          'sources: [E0001]',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
        '\n# Alpha\n\n## Claim\n\nE0001 says so.\n',
      ),
    )
    await write(
      'docs/wiki/note/W0009-beta.md',
      page(
        [
          'id: W0009',
          'kind: note',
          'title: Beta',
          'sources: [E0001-fused-attention]',
          'created_at: "2026-09-02T09:00:00+08:00"',
          'updated_at: "2026-09-02T09:00:00+08:00"',
        ].join('\n'),
      ),
    )

    const run = await runCapturing(() => runWikiBacklinks({ ...globals(), artifact: 'E0001' }))
    const parsed = jsonAs<{ pages: { id: string }[] }>(run.stdout)
    expect(parsed.pages.map((entry) => entry.id)).toEqual(['W0009', 'W0004'])
    expect(parsed).not.toHaveProperty('markdownReferences')
  })

  it('exits 0 with an empty list for an artifact nobody cites', async () => {
    const run = await runCapturing(() => runWikiBacklinks({ ...globals(), artifact: 'E9999' }))
    expect(run.exitCode).toBeNull()
    expect(JSON.parse(run.stdout)).toMatchObject({ pages: [] })
  })

  it('does not resolve ordinary Markdown links or scan run READMEs', async () => {
    await write('docs/reports/R0007-bf16-drift.md', '# bf16 drift\n\ntext\n')
    await write(
      'logs/bf16-260501-100000/README.md',
      '# Run\n\nsee [the report](../../docs/reports/R0007-bf16-drift.md)\n',
    )
    await write(
      'docs/digests/D0001-2026-05-02.md',
      '# digest\n\n[report](../reports/R0007-bf16-drift.md)\n',
    )

    const run = await runCapturing(() =>
      runWikiBacklinks({ ...globals(), artifact: 'R0007' }),
    )
    expect(jsonAs<{ pages: unknown[] }>(run.stdout)).toEqual({
      artifact: 'R0007',
      pages: [],
    })
  })
})

describe('memon wiki migrate-report', () => {
  it('migrates a single-file Report and removes the original', async () => {
    await write(
      'docs/reports/R0007-bf16-drift.md',
      `---\nid: R0007\ntitle: bf16 drift\nselector: 'tag:bf16'\ncreated_at: 2026-08-13T00:00:00+00:00\nupdated_at: 2026-08-13T00:00:00+00:00\n---\n\n# bf16 drift\n\nMeasured in E0002 and run bf16-260501-100000.\n`,
    )
    const run = await runCapturing(() =>
      runWikiMigrateReport({
        ...globals(),
        report: 'R0007',
        kind: 'finding',
        status: 'TENTATIVE',
      }),
    )
    expect(run.exitCode).toBeNull()
    const result = jsonAs<{
      oldPath: string
      newPath: string
      page: { id: string; legacyId: string; status: string; title: string }
    }>(run.stdout)
    expect(result.oldPath).toBe('docs/reports/R0007-bf16-drift.md')
    expect(result.newPath).toBe('docs/wiki/finding/W0001-bf16-drift.md')
    expect(result.page).toMatchObject({
      id: 'W0001',
      legacyId: 'R0007',
      status: 'TENTATIVE',
      title: 'bf16 drift',
    })
    expect(result).not.toHaveProperty('backlinks')

    const content = await readFile(result.newPath)
    expect(content).toContain('id: W0001')
    expect(content).toContain('kind: finding')
    expect(content).toContain('legacy_id: R0007')
    // `selector` survives verbatim as a value; only its YAML quoting is re-dumped.
    expect(content).toContain('selector: tag:bf16')
    expect(content).toContain('created_at: 2026-08-13T00:00:00+00:00')
    // `finding` requires evidence; the body's tokens seed `sources`.
    expect(content).toContain('- E0002')
    expect(content).toContain('- bf16-260501-100000')
    expect(await pathExists('docs/reports/R0007-bf16-drift.md')).toBe(false)
  })

  it('migrates a bundle with all of its assets', async () => {
    await write(
      'docs/reports/R0011-kernel-map/README.md',
      `---\nid: R0011\ntitle: Kernel map\ncreated_at: 2026-08-13T00:00:00+00:00\nupdated_at: 2026-08-13T00:00:00+00:00\n---\n\n# Kernel map\n\ntext\n`,
    )
    await write('docs/reports/R0011-kernel-map/data/fid.csv', 'a,b\n1,2\n')
    await write('docs/reports/R0011-kernel-map/views/explorer/index.html', '<p>x</p>\n')

    const run = await runCapturing(() =>
      runWikiMigrateReport({ ...globals(), report: 'R0011', kind: 'showcase' }),
    )
    expect(run.exitCode).toBeNull()
    expect((jsonAs<{ newPath: string }>(run.stdout)).newPath).toBe(
      'docs/wiki/showcase/W0001-kernel-map/README.md',
    )
    expect(await readFile('docs/wiki/showcase/W0001-kernel-map/data/fid.csv')).toBe('a,b\n1,2\n')
    expect(await pathExists('docs/wiki/showcase/W0001-kernel-map/views/explorer/index.html')).toBe(
      true,
    )
    expect(await pathExists('docs/reports/R0011-kernel-map')).toBe(false)
    expect(await readFile('docs/wiki/showcase/W0001-kernel-map/README.md')).toContain(
      'status: DRAFT',
    )
  })

  it('rolls back and keeps the Report when the migrated page would not lint', async () => {
    // No Experiment / Variant / run token in the body, so a `finding` page
    // would carry the WIKI_SOURCES_REQUIRED error.
    await write(
      'docs/reports/R0009-vague.md',
      `---\nid: R0009\ntitle: Vague\ncreated_at: 2026-08-13T00:00:00+00:00\nupdated_at: 2026-08-13T00:00:00+00:00\n---\n\n# Vague\n\nNo evidence here.\n`,
    )
    const run = await runCapturing(() =>
      runWikiMigrateReport({ ...globals(), report: 'R0009', kind: 'finding' }),
    )
    expect(run.exitCode).toBe(1)
    expect(errorOf(run).code).toBe('LINT_ERROR')
    expect(await pathExists('docs/wiki/finding/W0001-vague.md')).toBe(false)
    expect(await pathExists('docs/reports/R0009-vague.md')).toBe(true)
  })

  it('exits 4 for an unknown Report and 9 for a taken slug', async () => {
    await write(
      'docs/reports/R0007-bf16-drift.md',
      '# bf16 drift\n\nMeasured in E0002.\n',
    )
    await write(
      'docs/wiki/note/W0001-bf16-drift.md',
      page(
        [
          'id: W0001',
          'kind: note',
          'title: Taken',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )

    const missing = await runCapturing(() =>
      runWikiMigrateReport({ ...globals(), report: 'R0099', kind: 'note' }),
    )
    expect(missing.exitCode).toBe(4)

    const conflict = await runCapturing(() =>
      runWikiMigrateReport({ ...globals(), report: 'R0007', kind: 'finding' }),
    )
    expect(conflict.exitCode).toBe(9)
    expect(await pathExists('docs/reports/R0007-bf16-drift.md')).toBe(true)
  })
})

// ---------- review / commit (git) ----------

describe('memon wiki review and commit outside git', () => {
  it('exits 4 NOT_A_GIT_PROJECT for review and commit', async () => {
    await write(
      'docs/wiki/note/W0001-a.md',
      page(
        [
          'id: W0001',
          'kind: note',
          'title: A',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
    for (const run of [
      await runCapturing(() => runWikiReviewLog(globals())),
      await runCapturing(() => runWikiReviewDiff(globals())),
      await runCapturing(() => runWikiCommit(globals())),
    ]) {
      expect(run.exitCode).toBe(4)
      expect(errorOf(run).code).toBe('NOT_A_GIT_PROJECT')
    }
  })
})

describe('memon wiki review', () => {
  let shas: string[]

  beforeEach(async () => {
    await initGit()
    shas = []
    const relative = 'docs/wiki/note/W0001-a.md'
    await write(
      relative,
      page(
        [
          'id: W0001',
          'kind: note',
          'title: A',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
        '\n# A\n\nline one\n',
      ),
    )
    await git('add', '-A')
    await git('commit', '-m', 'wiki: c1')
    shas.push((await git('rev-parse', 'HEAD')).trim())

    await fs.appendFile(join(root, relative), 'line two\n', 'utf8')
    await git('add', '-A')
    await git('commit', '-m', 'wiki: c2')
    shas.push((await git('rev-parse', 'HEAD')).trim())

    await fs.appendFile(join(root, relative), 'line three\n', 'utf8')
    await git('add', '-A')
    await git('commit', '-m', 'wiki: c3')
    shas.push((await git('rev-parse', 'HEAD')).trim())
  })

  it('logs every wiki commit oldest first with its verification state', async () => {
    const run = await runCapturing(() => runWikiReviewLog(globals()))
    const parsed = jsonAs<{
      verifiedThrough: string | null
      commits: { sha: string; subject: string; pages: string[]; verified: boolean }[]
    }>(run.stdout)
    expect(parsed.verifiedThrough).toBeNull()
    expect(parsed.commits.map((commit) => commit.sha)).toEqual(shas)
    expect(parsed.commits.every((commit) => !commit.verified)).toBe(true)
    expect(parsed.commits[0]!.pages).toEqual(['W0001'])
  })

  it('verify next marks the oldest unmarked commit and names the following one', async () => {
    const first = await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: 'next' }))
    const parsed = jsonAs<{
      verified: { sha: string }
      verifiedThrough: string
      next: { sha: string }
    }>(first.stdout)
    expect(parsed.verified.sha).toBe(shas[0])
    expect(parsed.verifiedThrough).toBe(shas[0])
    expect(parsed.next.sha).toBe(shas[1])
    expect(await readFile('.memon/wiki-review.csv')).toContain(shas[0]!)
  })

  it('refuses an out-of-order verify with exit 9 REVIEW_ORDER', async () => {
    const run = await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: shas[2]! }))
    expect(run.exitCode).toBe(9)
    const error = errorOf(run)
    expect(error.code).toBe('REVIEW_ORDER')
    expect(error.message).toContain(shas[0]!)
  })

  it('unverify removes the named mark and every newer one', async () => {
    await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: 'next' }))
    await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: 'next', note: 'ok' }))
    const run = await runCapturing(() => runWikiReviewUnverify({ ...globals(), sha: shas[0]! }))
    const parsed = jsonAs<{ removed: string[]; verifiedThrough: string | null }>(run.stdout)
    expect(parsed.removed).toEqual([shas[0], shas[1]])
    expect(parsed.verifiedThrough).toBeNull()

    const missing = await runCapturing(() =>
      runWikiReviewUnverify({ ...globals(), sha: shas[0]! }),
    )
    expect(missing.exitCode).toBe(4)
  })
})

// ---------- review diff (one whole-wiki, commit-scoped diff) ----------

interface ReviewDiff {
  verifiedThrough: string | null
  verifiedAt: string | null
  base: string
  baseIsEmptyTree: boolean
  head: string | null
  pathspec: string
  files: string[]
  diff: string
}

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

describe('memon wiki review diff', () => {
  let seed: string

  const notePage = (id: string, slug: string, body: string): string =>
    page(
      [
        `id: ${id}`,
        'kind: note',
        `title: ${slug}`,
        'created_at: "2026-09-01T09:00:00+08:00"',
        'updated_at: "2026-09-01T09:00:00+08:00"',
      ].join('\n'),
      `\n# ${slug}\n\n${body}\n`,
    )

  beforeEach(async () => {
    await initGit()
    await write('docs/wiki/note/W0001-a.md', notePage('W0001', 'a', 'alpha alpha alpha'))
    await write('docs/wiki/note/W0002-b.md', notePage('W0002', 'b', 'beta beta beta'))
    await write('docs/wiki/note/W0003-c.md', notePage('W0003', 'c', 'gamma gamma gamma'))
    await git('add', '-A', '--', 'docs')
    await git('commit', '-m', 'wiki: seed')
    seed = (await git('rev-parse', 'HEAD')).trim()
  })

  it('diffs the whole committed wiki from the empty tree when nothing is verified', async () => {
    const run = await runCapturing(() => runWikiReviewDiff(globals()))
    const parsed = jsonAs<ReviewDiff>(run.stdout)
    expect(parsed.verifiedThrough).toBeNull()
    expect(parsed.verifiedAt).toBeNull()
    expect(parsed.base).toBe(EMPTY_TREE_SHA)
    expect(parsed.baseIsEmptyTree).toBe(true)
    expect(parsed.head).toBe(seed)
    expect(parsed.files).toEqual([
      'docs/wiki/note/W0001-a.md',
      'docs/wiki/note/W0002-b.md',
      'docs/wiki/note/W0003-c.md',
    ])
    expect(parsed.diff).toContain('new file mode')
    expect(parsed.diff).toContain('+alpha alpha alpha')
  })

  it('covers every committed wiki change since the verified commit, worktree excluded', async () => {
    await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: 'next' }))

    await fs.appendFile(join(root, 'docs/wiki/note/W0001-a.md'), 'committed edit\n', 'utf8')
    await fs.rm(join(root, 'docs/wiki/note/W0002-b.md'))
    await fs.mkdir(join(root, 'docs/wiki/retro'), { recursive: true })
    await git('mv', 'docs/wiki/note/W0003-c.md', 'docs/wiki/retro/W0003-c.md')
    await write(
      'docs/wiki/showcase/W0004-d/README.md',
      page(
        [
          'id: W0004',
          'kind: showcase',
          'title: d',
          'status: READY',
          'entry: plot ünicode.png',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
        '\n# d\n\ndelta showcase bundle over a binary asset\n',
      ),
    )
    await fs.writeFile(
      join(root, 'docs/wiki/showcase/W0004-d/plot ünicode.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]),
    )
    await write('src/train.py', 'print(1)\n')
    await git('add', '-A')
    await git('commit', '-m', 'wiki: reshape')
    const head = (await git('rev-parse', 'HEAD')).trim()
    // Only committed work can be verified, so this never reaches the diff.
    await fs.appendFile(join(root, 'docs/wiki/note/W0001-a.md'), 'worktree only\n', 'utf8')

    const run = await runCapturing(() => runWikiReviewDiff(globals()))
    const parsed = jsonAs<ReviewDiff>(run.stdout)
    expect(parsed.verifiedThrough).toBe(seed)
    expect(parsed.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    expect(parsed.base).toBe(seed)
    expect(parsed.baseIsEmptyTree).toBe(false)
    expect(parsed.head).toBe(head)
    expect(parsed.pathspec).toBe('docs/wiki')
    // `--raw -z` never quotes a path, so a rename reports both sides and a
    // space / non-ASCII asset name survives verbatim.
    for (const path of [
      'docs/wiki/note/W0001-a.md',
      'docs/wiki/note/W0002-b.md',
      'docs/wiki/note/W0003-c.md',
      'docs/wiki/retro/W0003-c.md',
      'docs/wiki/showcase/W0004-d/README.md',
      'docs/wiki/showcase/W0004-d/plot ünicode.png',
    ]) {
      expect(parsed.files).toContain(path)
    }
    // Non-wiki paths are outside the pathspec, committed in the same commit or not.
    expect(parsed.files.every((path) => path.startsWith('docs/wiki/'))).toBe(true)
    expect(parsed.diff).toContain('+committed edit')
    expect(parsed.diff).toContain('a/docs/wiki/note/W0002-b.md')
    expect(parsed.diff).toContain('docs/wiki/retro/W0003-c.md')
    // `--binary`, so a changed bundle asset is a complete patch.
    expect(parsed.diff).toContain('GIT binary patch')
    expect(parsed.diff).not.toContain('worktree only')
    expect(parsed.diff).not.toContain('src/train.py')
  })

  it('reports no committed change when HEAD is the verified commit', async () => {
    await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: 'next' }))
    const run = await runCapturing(() => runWikiReviewDiff(globals()))
    const parsed = jsonAs<ReviewDiff>(run.stdout)
    expect(parsed.base).toBe(seed)
    expect(parsed.head).toBe(seed)
    expect(parsed.files).toEqual([])
    expect(parsed.diff).toBe('')

    const human = await runCapturing(() => runWikiReviewDiff({ ...globals(), format: 'human' }))
    expect(human.stdout).toContain(`base: ${seed.slice(0, 10)} (verified `)
    expect(human.stdout).toContain('(no committed wiki changes since base)')
  })

  it('refuses a verified baseline that is no longer in the wiki history', async () => {
    await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: 'next' }))
    // History rewrite: the marked commit is unreachable. Falling back to the
    // empty tree would silently discard the human's verification.
    await git('commit', '--amend', '-m', 'wiki: seed amended')

    const run = await runCapturing(() => runWikiReviewDiff(globals()))
    expect(run.exitCode).toBe(9)
    expect(errorOf(run).code).toBe('REVIEW_STALE_BASELINE')
    expect(run.stdout).toBe('')
    expect(
      jsonAs<{ error: { details: { staleMarks: string[] } } }>(run.stderr).error.details.staleMarks,
    ).toEqual([seed])
  })
})

describe('memon wiki review diff without usable history', () => {
  beforeEach(async () => {
    await write(
      'docs/wiki/note/W0001-a.md',
      page(
        [
          'id: W0001',
          'kind: note',
          'title: A',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
      ),
    )
  })

  it('reports an unborn HEAD as no committed wiki history', async () => {
    await initGit()
    const run = await runCapturing(() => runWikiReviewDiff(globals()))
    expect(run.exitCode).toBeNull()
    const parsed = jsonAs<ReviewDiff>(run.stdout)
    expect(parsed.head).toBeNull()
    expect(parsed.base).toBe(EMPTY_TREE_SHA)
    expect(parsed.baseIsEmptyTree).toBe(true)
    expect(parsed.files).toEqual([])
    expect(parsed.diff).toBe('')

    const human = await runCapturing(() => runWikiReviewDiff({ ...globals(), format: 'human' }))
    expect(human.stdout).toContain('head: (unborn)')
    expect(human.stdout).toContain('(no wiki commits yet)')
  })

  it('surfaces a failing git diff instead of a clean one', async () => {
    const stub = [
      'case "$*" in',
      '  *--is-inside-work-tree*) echo true; exit 0;;',
      '  *--verify*) echo 1111111111111111111111111111111111111111; exit 0;;',
      '  *) echo "fatal: bad object" >&2; exit 128;;',
      'esac',
      '',
    ].join('\n')
    const run = await withStubbedGit(() => runCapturing(() => runWikiReviewDiff(globals())), stub)
    expect(run.result.exitCode).toBe(1)
    expect(errorOf(run.result).code).toBe('GIT_FAILED')
    expect(run.result.stdout).toBe('')
  })
})

describe('memon wiki commit', () => {
  beforeEach(async () => {
    await initGit()
    await write('src/train.py', 'print(1)\n')
    await git('add', '-A')
    await git('commit', '-m', 'init')
  })

  it('stages only docs/wiki and leaves other changes alone', async () => {
    await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'note', slug: 'alpha', title: 'Alpha' }),
    )
    await fs.appendFile(join(root, 'src/train.py'), 'print(2)\n', 'utf8')

    const run = await runCapturing(() =>
      runWikiCommit({ ...globals(), message: 'tighten W0001 limits' }),
    )
    expect(run.exitCode).toBeNull()
    const result = jsonAs<{
      sha: string
      subject: string
      pages: { id: string; change: string; paths: string[] }[]
      files: string[]
    }>(run.stdout)
    expect(result.subject).toBe('wiki: tighten W0001 limits')
    expect(result.files).toEqual(['docs/wiki/note/W0001-alpha.md'])
    // No review claim survives a commit: verification is whole-wiki.
    expect(result.pages).toEqual([
      { id: 'W0001', change: 'create', paths: ['docs/wiki/note/W0001-alpha.md'] },
    ])

    expect((await git('log', '-1', '--format=%s')).trim()).toBe('wiki: tighten W0001 limits')
    expect((await git('show', '--name-only', '--format=', 'HEAD')).trim()).toBe(
      'docs/wiki/note/W0001-alpha.md',
    )
    expect(await git('status', '--porcelain', '--', 'src/train.py')).toContain(' M src/train.py')
  })

  it('generates the summary from the touched pages when -m is omitted', async () => {
    await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'note', slug: 'alpha', title: 'Alpha' }),
    )
    await runCapturing(() => runWikiCommit({ ...globals(), message: 'first' }))

    await runCapturing(() => runWikiSet({ ...globals(), page: 'W0001', title: 'Alpha prime' }))
    await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'note', slug: 'beta', title: 'Beta' }),
    )
    const run = await runCapturing(() => runWikiCommit(globals()))
    expect((jsonAs<{ subject: string }>(run.stdout)).subject).toBe(
      'wiki: update W0001, create W0002',
    )
  })

  it('refuses a mixed index with exit 9 MIXED_INDEX and creates no commit', async () => {
    await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'note', slug: 'alpha', title: 'Alpha' }),
    )
    await fs.appendFile(join(root, 'src/train.py'), 'print(2)\n', 'utf8')
    await git('add', 'src/train.py')

    const run = await runCapturing(() => runWikiCommit(globals()))
    expect(run.exitCode).toBe(9)
    expect(errorOf(run).code).toBe('MIXED_INDEX')
    expect((await git('log', '-1', '--format=%s')).trim()).toBe('init')
  })

  it('refuses with exit 2 when there is nothing to stage', async () => {
    const run = await runCapturing(() => runWikiCommit(globals()))
    expect(run.exitCode).toBe(2)
    expect((await git('log', '-1', '--format=%s')).trim()).toBe('init')
  })
})

// ---------- components / lint --central (stub central dashboard) ----------

interface StubRequest {
  method: string
  url: string
  authorization?: string
  body: string
}

describe('memon wiki components', () => {
  let server: Server
  let central: string
  let requests: StubRequest[]
  let savedEnv: Record<string, string | undefined>

  beforeEach(async () => {
    requests = []
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          ...(req.headers.authorization === undefined
            ? {}
            : { authorization: req.headers.authorization }),
          body,
        })
        const url = req.url ?? ''
        res.setHeader('content-type', 'application/json')
        if (url === '/api/wiki/components') {
          res.end(
            JSON.stringify({
              components: [
                { name: 'memon-data', version: 1, description: 'Tabular data', outdated: false },
                { name: 'html-embed', version: 1, description: 'Embedded HTML', outdated: false },
              ],
            }),
          )
          return
        }
        if (url === '/api/wiki/components/memon-data%401') {
          res.end(
            JSON.stringify({
              name: 'memon-data',
              version: 1,
              effect: 'Renders a table',
              useWhen: 'small tables',
              args: { title: 'string' },
              example: '```memon-data@1\n```',
              invalidExamples: [],
              fixtures: [],
            }),
          )
          return
        }
        if (url === '/api/wiki/components/nope') {
          res.statusCode = 404
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no such component' } }))
          return
        }
        if (url === '/api/wiki/components/lint') {
          res.end(
            JSON.stringify({
              diagnostics: [
                {
                  code: 'WIKI_DATA_BLOCK_INVALID',
                  severity: 'error',
                  message: 'ragged rows',
                  line: 12,
                },
              ],
              components: [],
            }),
          )
          return
        }
        if (url === '/api/wiki/components/migrate') {
          const parsed = jsonAs<{ content: string }>(body)
          res.end(
            JSON.stringify({ content: parsed.content.replace('```memon-data\n', '```memon-data@1\n') }),
          )
          return
        }
        res.statusCode = 404
        res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: url } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    central = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    savedEnv = {
      MEMON_CENTRAL_URL: process.env.MEMON_CENTRAL_URL,
      MEMON_CENTRAL_TOKEN: process.env.MEMON_CENTRAL_TOKEN,
      MEMON_CENTRAL_USER: process.env.MEMON_CENTRAL_USER,
      MEMON_CENTRAL_PASS: process.env.MEMON_CENTRAL_PASS,
    }
    for (const key of Object.keys(savedEnv)) delete process.env[key]
  })

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  })

  it('exits 2 and names both ways to configure central when none is set', async () => {
    const run = await runCapturing(() => runWikiComponentsLs(globals()))
    expect(run.exitCode).toBe(2)
    const message = errorOf(run).message
    expect(message).toContain('--central')
    expect(message).toContain('MEMON_CENTRAL_URL')
    expect(requests).toHaveLength(0)
  })

  it('reads the registry from MEMON_CENTRAL_URL and prints name, version, description', async () => {
    process.env.MEMON_CENTRAL_URL = central
    const run = await runCapturing(() => runWikiComponentsLs({ ...globals(), format: 'human' }))
    expect(run.stdout).toContain('memon-data@1')
    expect(run.stdout).toContain('Tabular data')
    expect(requests[0]).toMatchObject({ method: 'GET', url: '/api/wiki/components' })
  })

  it('sends a bearer token, or Basic credentials, from the environment', async () => {
    process.env.MEMON_CENTRAL_TOKEN = 't0k'
    await runCapturing(() => runWikiComponentsLs({ ...globals(), central }))
    expect(requests[0]!.authorization).toBe('Bearer t0k')

    delete process.env.MEMON_CENTRAL_TOKEN
    process.env.MEMON_CENTRAL_USER = 'owner'
    process.env.MEMON_CENTRAL_PASS = 'secret'
    await runCapturing(() => runWikiComponentsLs({ ...globals(), central }))
    expect(requests[1]!.authorization).toBe(`Basic ${Buffer.from('owner:secret').toString('base64')}`)
  })

  it('shows one pinned descriptor and maps a central 404 to exit 4', async () => {
    const shown = await runCapturing(() =>
      runWikiComponentsShow({ ...globals(), name: 'memon-data@1', central }),
    )
    expect(JSON.parse(shown.stdout)).toMatchObject({
      name: 'memon-data',
      version: 1,
      effect: 'Renders a table',
      useWhen: 'small tables',
    })
    expect(requests[0]!.url).toBe('/api/wiki/components/memon-data%401')

    const missing = await runCapturing(() =>
      runWikiComponentsShow({ ...globals(), name: 'nope', central }),
    )
    expect(missing.exitCode).toBe(4)
    expect(errorOf(missing).code).toBe('NOT_FOUND')
  })

  it('migrates a page body through central, honouring --dry-run', async () => {
    const relative = 'docs/wiki/note/W0001-data.md'
    await write(
      relative,
      page(
        [
          'id: W0001',
          'kind: note',
          'title: Data',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
        '\n# Data\n\n```memon-data\ncolumns: [a]\nrows: [[1]]\n```\n',
      ),
    )
    const before = await readFile(relative)

    const dry = await runCapturing(() =>
      runWikiComponentsMigrate({ ...globals(), central, dryRun: true }),
    )
    expect((jsonAs<{ pages: { changed: boolean; written: boolean }[] }>(dry.stdout)).pages).toEqual([
      { id: 'W0001', path: relative, changed: true, written: false },
    ])
    expect(await readFile(relative)).toBe(before)
    const requested = jsonAs<{ content: string }>(requests[0]!.body).content
    expect(requested).toBe(parseWikiFrontmatter(before).body)
    expect(requested).not.toContain('id: W0001')


    const applied = await runCapturing(() => runWikiComponentsMigrate({ ...globals(), central }))
    expect((jsonAs<{ pages: { written: boolean }[] }>(applied.stdout)).pages[0]!.written).toBe(
      true,
    )
    expect(await readFile(relative)).toContain('```memon-data@1')
    expect(await readFile(relative)).toBe(before.replace('```memon-data\n', '```memon-data@1\n'))
  })

  it('lint --central merges central component diagnostics', async () => {
    await write(
      'docs/wiki/note/W0001-data.md',
      page(
        [
          'id: W0001',
          'kind: note',
          'title: Data',
          'created_at: "2026-09-01T09:00:00+08:00"',
          'updated_at: "2026-09-01T09:00:00+08:00"',
        ].join('\n'),
        '\n# Data\n\n```memon-data@1\ncolumns: [a]\nrows: [[1, 2]]\n```\n',
      ),
    )
    const local = await runCapturing(() => runWikiLint({ ...globals(), strict: true }))
    expect(local.exitCode).toBeNull()
    expect(local.stdout).not.toContain('WIKI_DATA_BLOCK_INVALID')

    const withCentral = await runCapturing(() =>
      runWikiLint({ ...globals(), strict: true, central }),
    )
    expect(withCentral.exitCode).toBe(1)
    expect(withCentral.stdout).toContain('WIKI_DATA_BLOCK_INVALID')
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/api/wiki/components/lint' })
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ content: expect.any(String) })
  })
})
