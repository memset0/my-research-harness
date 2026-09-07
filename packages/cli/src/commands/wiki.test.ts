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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseWikiFrontmatter } from '@memon/core'

import { runExperimentCreate } from './experiment-doc.js'
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
  runWikiLs,
  runWikiMigrateReport,
  runWikiMove,
  runWikiReviewDiff,
  runWikiReviewLog,
  runWikiReviewLs,
  runWikiReviewUnverify,
  runWikiReviewVerify,
  runWikiSet,
  runWikiShow,
  runWikiStale,
  runWikiUndeprecate,
} from './wiki.js'

const execFileAsync = promisify(execFile)

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-wiki-cli-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
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
    expect(run.stdout).toContain('| id | path | status | review | stale | updated_at | title | description |')
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

  it('--stale keeps only pages whose evidence moved on', async () => {
    // W0001 cites W0002, whose `updated_at` is newer.
    const run = await runCapturing(() => runWikiLs({ ...globals(), stale: true }))
    const parsed = jsonAs<{ pages: { id: string; staleSources: string[] }[] }>(run.stdout)
    expect(parsed.pages).toHaveLength(1)
    expect(parsed.pages[0]).toMatchObject({ id: 'W0001', staleSources: ['W0002'] })
  })

  it('rejects an unknown --review state and an unknown --format', async () => {
    const review = await runCapturing(() => runWikiLs({ ...globals(), review: 'MAYBE' }))
    expect(review.exitCode).toBe(2)
    expect(errorOf(review).code).toBe('BAD_REQUEST')

    const format = await runCapturing(() => runWikiLs({ ...globals(), format: 'yaml' }))
    expect(format.exitCode).toBe(2)
  })

  it('reports stale pages through `stale` too', async () => {
    const run = await runCapturing(() => runWikiStale(globals()))
    const parsed = jsonAs<{ pages: { id: string; staleSources: string[] }[] }>(run.stdout)
    expect(parsed.pages.map((entry) => entry.id)).toEqual(['W0001'])
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
      stale: boolean
      absolutePath: string
    }>(run.stdout)
    expect(summary.id).toBe('W0001')
    expect(summary.path).toBe('docs/wiki/finding/W0001-vsa-debt.md')
    expect(summary.stale).toBe(false)
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
        addSource: ['E0003'],
        rmSource: ['E0001'],
        addTag: ['perf'],
        rmTag: ['debt'],
      }),
    )
    const summary = jsonAs<{ sources: string[]; tags: string[] }>(run.stdout)
    expect(summary.sources).toEqual(['E0003'])
    expect(summary.tags).toEqual(['vsa', 'perf'])
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

  it('exits 4 for an unknown successor and leaves the file unchanged', async () => {
    const before = await readFile('docs/wiki/note/W0004-old-claim.md')
    const run = await runCapturing(() =>
      runWikiDeprecate({ ...globals(), page: 'W0004', reason: 'x', supersededBy: 'W9999' }),
    )
    expect(run.exitCode).toBe(4)
    expect(await readFile('docs/wiki/note/W0004-old-claim.md')).toBe(before)
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
    await runCapturing(() =>
      runExperimentCreate({
        projectRoot: root,
        cwd: root,
        slug: 'fused-attention',
        title: 'Fused attention',
      }),
    )
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

  it('adds markdownReferences for a Report id, run READMEs included', async () => {
    await write('docs/reports/R0007-bf16-drift.md', '# bf16 drift\n\ntext\n')
    await write(
      'logs/bf16-260501-100000/README.md',
      `---\nid: bf16-260501-100000\nname: bf16\nstatus: FINISHED\narchived: false\nexperiment: null\ncreated_at: '2026-05-01T10:00:00+08:00'\nupdated_at: '2026-05-01T11:00:00+08:00'\nhost: test\npid: null\ngpus: []\nentry: ./train.sh\ncommand: ./train.sh\nwandb: null\n---\n\n## Setup\n\nsee [the report](../../docs/reports/R0007-bf16-drift.md)\n\n## Result\n\nx\n\n## Artifacts\n`,
    )
    await write('docs/digests/D0001-2026-05-02.md', '# digest\n\n[report](../reports/R0007-bf16-drift.md)\n')
    await write('docs/digests/D0002-2026-05-03.md', '# digest\n\n[other](../reports/R0008-other.md)\n')

    const run = await runCapturing(() => runWikiBacklinks({ ...globals(), artifact: 'R0007' }))
    const parsed = jsonAs<{ markdownReferences: { path: string }[] }>(run.stdout)
    expect(parsed.markdownReferences.map((entry) => entry.path)).toEqual([
      'docs/digests/D0001-2026-05-02.md',
      'logs/bf16-260501-100000/README.md',
    ])
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
      await runCapturing(() => runWikiReviewLs(globals())),
      await runCapturing(() => runWikiReviewDiff({ ...globals(), page: 'W0001' })),
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

  it('diffs from verifiedThrough to the worktree, and prints nothing when VERIFIED', async () => {
    await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: 'next' }))
    const partial = await runCapturing(() =>
      runWikiReviewLs({ ...globals(), state: 'CHANGED_SINCE_VERIFY' }),
    )
    expect((jsonAs<{ pages: { id: string }[] }>(partial.stdout)).pages).toHaveLength(1)

    const diff = await runCapturing(() =>
      runWikiReviewDiff({ ...globals(), page: 'W0001', format: 'human' }),
    )
    expect(diff.exitCode).toBeNull()
    expect(diff.stdout).toContain('line three')
    expect(diff.stdout).toContain(`--- a/docs/wiki/note/W0001-a.md`)

    await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: 'next' }))
    await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: 'next' }))
    const verified = await runCapturing(() => runWikiReviewLs({ ...globals(), state: 'VERIFIED' }))
    expect((jsonAs<{ pages: { id: string }[] }>(verified.stdout)).pages).toHaveLength(1)

    const empty = await runCapturing(() =>
      runWikiReviewDiff({ ...globals(), page: 'W0001', format: 'human' }),
    )
    expect(empty.exitCode).toBeNull()
    expect(empty.stdout).toBe('')
  })

  it('exposes the same review object through ls --review and show', async () => {
    await runCapturing(() => runWikiReviewVerify({ ...globals(), sha: 'next' }))
    const listed = await runCapturing(() =>
      runWikiLs({ ...globals(), review: 'CHANGED_SINCE_VERIFY' }),
    )
    const pages = (jsonAs<{ pages: { id: string; review: unknown }[] }>(listed.stdout)).pages
    expect(pages.map((entry) => entry.id)).toEqual(['W0001'])

    const shown = await runCapturing(() => runWikiShow({ ...globals(), page: 'W0001' }))
    expect((jsonAs<{ review: unknown }>(shown.stdout)).review).toEqual(pages[0]!.review)
  })

  it('exits 4 for review diff on an unknown page', async () => {
    const run = await runCapturing(() => runWikiReviewDiff({ ...globals(), page: 'nope' }))
    expect(run.exitCode).toBe(4)
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
      pages: { id: string; change: string; reviewState: string }[]
      files: string[]
    }>(run.stdout)
    expect(result.subject).toBe('wiki: tighten W0001 limits')
    expect(result.files).toEqual(['docs/wiki/note/W0001-alpha.md'])
    expect(result.pages).toEqual([
      {
        id: 'W0001',
        change: 'create',
        paths: ['docs/wiki/note/W0001-alpha.md'],
        reviewState: 'UNVERIFIED',
        verifiedThrough: null,
      },
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
