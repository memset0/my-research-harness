// `memon wiki` CLI behaviour, scenario-for-scenario against the wiki-cli spec.
//
// Every case runs against a throwaway project root; the review / commit cases
// build a throwaway git repo.

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runWikiCreate, runWikiMove, runWikiShow } from './wiki.js'

const execFileAsync = promisify(execFile)

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

async function _initGit(): Promise<void> {
  await git('init', '-b', 'main')
  await git('config', 'user.email', 'test@example.invalid')
  await git('config', 'user.name', 'memon test')
  await git('config', 'commit.gpgsign', 'false')
}

/** One row per linted page: its id and the diagnostic codes it reported. */
function _lintRows(run: CapturedRun): { id: string; codes: string[] }[] {
  return jsonAs<{ pages: { id: string; diagnostics: { code: string }[] }[] }>(run.stdout).pages.map(
    (entry) => ({ id: entry.id, codes: entry.diagnostics.map((diagnostic) => diagnostic.code) }),
  )
}

/**
 * Run `fn` with a recording stub as the only `git` on PATH, so git is both
 * unavailable and observable: `calls` lists the argv of every invocation.
 * `script` replaces the stub's body when a case needs specific git answers.
 */
async function _withStubbedGit<T>(
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
    // Free-form Markdown no longer requires the legacy kind's H2 outline.
    expect(parsed.diagnostics.map((entry) => entry.code)).not.toContain('WIKI_MISSING_SECTION')
    expect(parsed.content).toContain('---\nid: W0004')
  })

  it('--body-only drops the frontmatter', async () => {
    const json = await runCapturing(() =>
      runWikiShow({ ...globals(), page: 'W0004', bodyOnly: true }),
    )
    expect(jsonAs<{ content: string }>(json.stdout).content).not.toContain('id: W0004')

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
  it('writes a minimal folder and reports the new summary', async () => {
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
    expect(summary.path).toBe('docs/wiki/finding/W0001-vsa-debt/README.md')
    expect(summary).not.toHaveProperty('stale')
    expect(summary.absolutePath).toBe(join(root, summary.path))

    const content = await readFile(summary.path)
    expect(content).toContain('id: W0001')
    expect(content).toContain('kind: finding')
    expect(content).toContain('status: VERIFIED')
    expect(content).toContain('description: Common path pays for VSA even when disabled.')
    expect(content).toContain('- E0017')
    expect(content).toContain('# VSA common-path debt')
    expect(content).not.toMatch(/^## /m)
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
    expect(jsonAs<{ id: string }>(run.stdout).id).toBe('W0008')
  })

  it('writes language without a fixed scaffold and rejects an unknown language', async () => {
    const run = await runCapturing(() =>
      runWikiCreate({
        ...globals(),
        kind: 'finding',
        slug: 'kv-cache',
        title: 'KV cache 显存占用',
        language: 'zh',
        source: ['E0017'],
      }),
    )
    expect(run.exitCode).toBeNull()
    const summary = jsonAs<{ path: string; language: string }>(run.stdout)
    expect(summary.language).toBe('zh')
    const content = await readFile(summary.path)
    expect(content).toContain('language: zh')
    // Section headings stay English whatever the page language is.
    expect(content).not.toMatch(/^## /m)
    expect(content).not.toContain('## 结论')

    const english = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'note', slug: 'plain', title: 'Plain' }),
    )
    expect(jsonAs<{ language: string; path: string }>(english.stdout).language).toBe('en')
    expect(await readFile('docs/wiki/note/W0002-plain/README.md')).not.toContain('language:')

    const invalid = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'note', slug: 'bad', title: 'Bad', language: 'fr' }),
    )
    expect(invalid.exitCode).toBe(2)
    expect(errorOf(invalid).code).toBe('BAD_REQUEST')
    expect(errorOf(invalid).message).toContain('--language')
    expect(await pathExists('docs/wiki/note/W0003-bad.md')).toBe(false)
  })

  it('leaves status and meeting date optional', async () => {
    const created = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'question', slug: 'why', title: 'Why?' }),
    )
    expect(jsonAs<{ status: string | null }>(created.stdout).status).toBeNull()
    const meeting = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'meeting', slug: 'weekly', title: 'Weekly' }),
    )
    expect(meeting.exitCode).toBeNull()
    expect(await readFile('docs/wiki/meeting/W0002-weekly/README.md')).not.toMatch(/^date:/m)
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
      path: 'docs/wiki/roadmap/W0001-research-plan/README.md',
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

  it('accepts topic categories and rejects unsafe paths or invalid declared status', async () => {
    const topic = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'methods', slug: 'topic', title: 'Topic' }),
    )
    expect(topic.exitCode).toBeNull()
    const badStatus = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: 'finding', slug: 'x', title: 'x', status: 'NOPE' }),
    )
    expect(badStatus.exitCode).toBe(2)
    const unsafe = await runCapturing(() =>
      runWikiCreate({ ...globals(), kind: '../outside', slug: 'x', title: 'x' }),
    )
    expect(unsafe.exitCode).toBe(2)
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
    expect(jsonAs<{ newPath: string }>(run.stdout).newPath).toBe(
      'docs/wiki/question/W0012-kernel-abi.md',
    )
  })

  it('drops an incompatible optional status when moving category', async () => {
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
    const run = await runCapturing(() =>
      runWikiMove({ ...globals(), page: 'W0013', target: 'bottleneck' }),
    )
    expect(run.exitCode).toBeNull()
    expect(await readFile('docs/wiki/bottleneck/W0013-verified.md')).not.toMatch(/^status:/m)
  })

  it('refuses a taken target slug and permits other categories', async () => {
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
    expect(reserved.exitCode).toBeNull()
  })
})
