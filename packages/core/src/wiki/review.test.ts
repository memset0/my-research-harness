import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { execFileGitCommand, type GitCommandRunner } from '../git/command.js'
import {
  WIKI_REVIEW_RELPATH,
  deriveWikiReview,
  isGitWorktree,
  listWikiCommits,
  parseWikiReviewCsv,
  readWikiReviewMarks,
  removeWikiReviewMark,
  serializeWikiReviewCsv,
  verifiedThroughMark,
  WikiReviewError,
  WikiReviewOrderError,
  writeWikiReviewMark,
  type WikiCommit,
} from './review.js'

const execFileAsync = promisify(execFile)

const ALPHA = 'docs/wiki/finding/W0001-alpha.md'
const BETA = 'docs/wiki/note/W0002-beta.md'
const DEMO = 'docs/wiki/showcase/W0003-demo/README.md'
const DEMO_ASSET = 'docs/wiki/showcase/W0003-demo/views/chart.svg'

let root: string

async function git(args: string[], cwd = root): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'memon',
      GIT_AUTHOR_EMAIL: 'memon@example.com',
      GIT_COMMITTER_NAME: 'memon',
      GIT_COMMITTER_EMAIL: 'memon@example.com',
    },
  })
  return stdout.trim()
}

async function writeRepoFile(relPath: string, content: string): Promise<void> {
  const abs = join(root, relPath)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

async function commit(subject: string): Promise<string> {
  await git(['add', '-A'])
  await git(['commit', '-m', subject])
  return git(['rev-parse', 'HEAD'])
}

/** 20-line page: 8 frontmatter lines + 12 body lines (`body 1`…`body 12`). */
function page(id: string, kind: string, bodyLabel: string): string {
  const front = [
    '---',
    `id: ${id}`,
    `kind: ${kind}`,
    `title: ${id} page`,
    'created_at: 2026-05-01T10:00:00+08:00',
    'updated_at: 2026-05-01T10:00:00+08:00',
    '---',
    '',
  ]
  const body = Array.from({ length: 12 }, (_, i) => `${bodyLabel} body ${i + 1}`)
  return `${[...front, ...body].join('\n')}\n`
}

/** Rewrite 1-based lines `from`..`to` of a repo file. */
async function rewriteLines(
  relPath: string,
  from: number,
  to: number,
  label: string,
): Promise<void> {
  const abs = join(root, relPath)
  const text = await readFile(abs, 'utf8')
  const lines = text.split('\n')
  for (let n = from; n <= to; n += 1) lines[n - 1] = `${label} rewritten ${n}`
  await writeFile(abs, lines.join('\n'), 'utf8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memon-wiki-review-'))
  await git(['init', '--initial-branch=main', '.'])
  await git(['config', 'user.name', 'memon'])
  await git(['config', 'user.email', 'memon@example.com'])
  await git(['config', 'commit.gpgsign', 'false'])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * Fixture history (oldest → newest):
 *   c0  unrelated README (not a wiki commit)
 *   c1  add W0001 (20 lines)
 *   c2  add W0002, add W0003 bundle (README + views/chart.svg)
 *   c3  rewrite lines 12-18 of W0001
 *   c4  rewrite the W0003 bundle asset only
 */
interface Fixture {
  c1: string
  c2: string
  c3: string
  c4: string
}

async function buildFixture(): Promise<Fixture> {
  await writeRepoFile('README.md', '# project\n')
  await commit('chore: init')

  await writeRepoFile(ALPHA, page('W0001', 'finding', 'alpha'))
  const c1 = await commit('wiki: add W0001')

  await writeRepoFile(BETA, page('W0002', 'note', 'beta'))
  await writeRepoFile(DEMO, page('W0003', 'showcase', 'demo'))
  await writeRepoFile(DEMO_ASSET, '<svg data="v1"/>\n')
  const c2 = await commit('wiki: add W0002 and W0003')

  await rewriteLines(ALPHA, 12, 18, 'alpha')
  const c3 = await commit('wiki: revise W0001 middle')

  await writeRepoFile(DEMO_ASSET, '<svg data="v2"/>\n')
  const c4 = await commit('wiki: refresh W0003 chart')

  return { c1, c2, c3, c4 }
}

describe('listWikiCommits', () => {
  it('lists only wiki commits, oldest first, with page attribution', async () => {
    const { c1, c2, c3, c4 } = await buildFixture()
    const commits = (await listWikiCommits(root)) as WikiCommit[]

    expect(commits.map((c) => c.sha)).toEqual([c1, c2, c3, c4])
    expect(commits[0]!.subject).toBe('wiki: add W0001')
    expect(commits[0]!.pages).toEqual(['W0001'])
    expect(commits[1]!.pages).toEqual(['W0002', 'W0003'])
    expect(commits[3]!.pages).toEqual(['W0003'])
    expect(commits[3]!.files).toEqual([DEMO_ASSET])
    expect(commits[0]!.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })

  it('attributes a page whose path carries no W id via frontmatter at that commit', async () => {
    await writeRepoFile('docs/wiki/note/legacy-page.md', page('W0042', 'note', 'legacy'))
    const sha = await commit('wiki: add legacy-named page')

    const commits = (await listWikiCommits(root)) as WikiCommit[]
    expect(commits).toHaveLength(1)
    expect(commits[0]!.sha).toBe(sha)
    expect(commits[0]!.pages).toEqual(['W0042'])
  })
})

describe('mark store', () => {
  it('round-trips notes with commas and quotes (RFC 4180)', async () => {
    const { c1 } = await buildFixture()
    const mark = await writeWikiReviewMark(root, c1, 'checked "twice", carefully')

    expect(mark.sha).toBe(c1)
    expect(mark.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)

    const csv = await readFile(join(root, WIKI_REVIEW_RELPATH), 'utf8')
    expect(csv.split('\n')[0]).toBe('sha,verified_at,note')
    expect(csv).toContain('"checked ""twice"", carefully"')

    const marks = await readWikiReviewMarks(root)
    expect(marks).toEqual([mark])
  })

  it('stores rows in commit order regardless of marking order', async () => {
    const { c1, c2, c3 } = await buildFixture()
    // Marking must be sequential, so the file order equals commit order; write
    // the rows shuffled by hand and confirm the next write re-sorts them.
    await writeWikiReviewMark(root, c1)
    await writeWikiReviewMark(root, c2)
    await writeFile(
      join(root, WIKI_REVIEW_RELPATH),
      serializeWikiReviewCsv([
        { sha: c2, verifiedAt: '2026-05-02T10:00:00+08:00', note: '' },
        { sha: c1, verifiedAt: '2026-05-01T10:00:00+08:00', note: '' },
      ]),
      'utf8',
    )
    await writeWikiReviewMark(root, c3)

    const marks = await readWikiReviewMarks(root)
    expect(marks.map((m) => m.sha)).toEqual([c1, c2, c3])
  })

  it('skips malformed rows and rejects a foreign header', () => {
    const csv =
      'sha,verified_at,note\n' +
      'not-a-sha,2026-05-01T10:00:00+08:00,\n' +
      `${'a'.repeat(40)},2026-05-01T10:00:00+08:00\n` +
      `${'b'.repeat(40)},2026-05-01T10:00:00+08:00,ok\n`
    expect(parseWikiReviewCsv(csv).map((m) => m.sha)).toEqual(['b'.repeat(40)])
    expect(parseWikiReviewCsv('sha,status,note,updated_at,submodule\n')).toEqual([])
  })

  it('is idempotent and updates the note on re-mark', async () => {
    const { c1 } = await buildFixture()
    const first = await writeWikiReviewMark(root, c1, 'first pass')
    const again = await writeWikiReviewMark(root, c1)
    expect(again).toEqual(first)

    const updated = await writeWikiReviewMark(root, c1, 'second pass')
    expect(updated.note).toBe('second pass')
    expect(await readWikiReviewMarks(root)).toHaveLength(1)
  })

  it('accepts a short prefix and `next`', async () => {
    const { c1, c2 } = await buildFixture()
    const byPrefix = await writeWikiReviewMark(root, c1.slice(0, 8))
    expect(byPrefix.sha).toBe(c1)

    const byNext = await writeWikiReviewMark(root, 'next')
    expect(byNext.sha).toBe(c2)
  })

  it('rejects an unknown commit with NOT_FOUND', async () => {
    await buildFixture()
    await expect(writeWikiReviewMark(root, 'f'.repeat(40))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    // A commit that touches nothing under docs/wiki is not a wiki commit.
    const nonWiki = await git(['rev-list', '--max-parents=0', 'HEAD'])
    await expect(writeWikiReviewMark(root, nonWiki)).rejects.toBeInstanceOf(WikiReviewError)
  })
})

describe('sequential marking and cascading unmark', () => {
  it('refuses an out-of-order mark and offers the next commit', async () => {
    const { c1, c2, c3 } = await buildFixture()
    await writeWikiReviewMark(root, c1)

    const err = await writeWikiReviewMark(root, c3).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WikiReviewOrderError)
    expect(err).toMatchObject({ code: 'REVIEW_ORDER', nextSha: c2 })
    expect((await readWikiReviewMarks(root)).map((m) => m.sha)).toEqual([c1])
  })

  it('removes every newer mark when a mark is removed', async () => {
    const { c1, c2, c3 } = await buildFixture()
    await writeWikiReviewMark(root, c1)
    await writeWikiReviewMark(root, c2)
    await writeWikiReviewMark(root, c3)

    const result = await removeWikiReviewMark(root, c2)
    expect(result.removed).toEqual([c2, c3])
    expect(result.verifiedThrough).toBe(c1)

    const marks = await readWikiReviewMarks(root)
    expect(marks.map((m) => m.sha)).toEqual([c1])
    expect(verifiedThroughMark(await listWikiCommits(root), marks)?.sha).toBe(c1)
  })

  it('is a no-op for a sha that is not marked', async () => {
    const { c1, c3 } = await buildFixture()
    await writeWikiReviewMark(root, c1)
    const result = await removeWikiReviewMark(root, c3)
    expect(result).toEqual({ removed: [], verifiedThrough: c1 })
    expect((await readWikiReviewMarks(root)).map((m) => m.sha)).toEqual([c1])
  })
})

describe('deriveWikiReview', () => {
  it('reports UNVERIFIED for every page when nothing is marked', async () => {
    await buildFixture()
    const review = (await deriveWikiReview(root, [ALPHA, BETA, DEMO], []))!

    const alpha = review.get(ALPHA)!
    expect(alpha.state).toBe('UNVERIFIED')
    expect(alpha.verifiedThrough).toBeNull()
    expect(alpha.verifiedAt).toBeNull()
    expect(alpha.dirty).toBe(false)
    expect(alpha.unverifiedRanges).toEqual([[1, 20]])
    expect(review.get(BETA)!.state).toBe('UNVERIFIED')
    expect(review.get(DEMO)!.state).toBe('UNVERIFIED')
  })

  it('reports VERIFIED when every line and asset is covered', async () => {
    const { c1, c2, c3, c4 } = await buildFixture()
    for (const sha of [c1, c2, c3, c4]) await writeWikiReviewMark(root, sha)
    const marks = await readWikiReviewMarks(root)

    const review = (await deriveWikiReview(root, [ALPHA, BETA, DEMO], marks))!
    for (const path of [ALPHA, BETA, DEMO]) {
      const page = review.get(path)!
      expect(page.state).toBe('VERIFIED')
      expect(page.unverifiedRanges).toEqual([])
      expect(page.unverifiedCommits).toEqual([])
      expect(page.dirty).toBe(false)
      expect(page.verifiedThrough).toBe(c4)
      expect(page.verifiedAt).toBe(marks[marks.length - 1]!.verifiedAt)
    }
  })

  it('reports the exact line ranges rewritten after the verified prefix', async () => {
    const { c1, c2, c3 } = await buildFixture()
    await writeWikiReviewMark(root, c1)
    await writeWikiReviewMark(root, c2)
    const marks = await readWikiReviewMarks(root)

    const review = (await deriveWikiReview(root, [ALPHA, BETA], marks))!
    const alpha = review.get(ALPHA)!
    expect(alpha.state).toBe('CHANGED_SINCE_VERIFY')
    expect(alpha.unverifiedRanges).toEqual([[12, 18]])
    expect(alpha.unverifiedCommits).toEqual([c3])
    expect(alpha.dirty).toBe(false)
    expect(alpha.verifiedThrough).toBe(c2)

    // A page untouched by the newer commits stays fully verified.
    expect(review.get(BETA)!.state).toBe('VERIFIED')
    expect(review.get(BETA)!.unverifiedCommits).toEqual([])
  })

  it('counts a bundle asset changed after the prefix as whole-file unverified', async () => {
    const { c1, c2, c3, c4 } = await buildFixture()
    for (const sha of [c1, c2, c3]) await writeWikiReviewMark(root, sha)
    const marks = await readWikiReviewMarks(root)

    const demo = (await deriveWikiReview(root, [DEMO], marks))!.get(DEMO)!
    expect(demo.state).toBe('CHANGED_SINCE_VERIFY')
    // The README itself is unchanged, so no Markdown line range is unverified.
    expect(demo.unverifiedRanges).toEqual([])
    expect(demo.unverifiedCommits).toEqual([c4])
    expect(demo.dirty).toBe(false)
  })

  it('marks an uncommitted edit dirty and wholly unverified', async () => {
    const { c1, c2, c3, c4 } = await buildFixture()
    for (const sha of [c1, c2, c3, c4]) await writeWikiReviewMark(root, sha)
    const marks = await readWikiReviewMarks(root)
    await rewriteLines(ALPHA, 9, 9, 'alpha uncommitted')

    const review = (await deriveWikiReview(root, [ALPHA, BETA], marks))!
    const alpha = review.get(ALPHA)!
    expect(alpha.state).toBe('CHANGED_SINCE_VERIFY')
    expect(alpha.dirty).toBe(true)
    expect(alpha.unverifiedRanges).toEqual([[1, 20]])
    expect(alpha.unverifiedCommits).toEqual([])
    expect(review.get(BETA)!.dirty).toBe(false)
  })

  it('marks an uncommitted bundle asset dirty', async () => {
    const { c1, c2, c3, c4 } = await buildFixture()
    for (const sha of [c1, c2, c3, c4]) await writeWikiReviewMark(root, sha)
    const marks = await readWikiReviewMarks(root)
    await writeRepoFile(DEMO_ASSET, '<svg data="v3-uncommitted"/>\n')

    const demo = (await deriveWikiReview(root, [DEMO], marks))!.get(DEMO)!
    expect(demo.state).toBe('CHANGED_SINCE_VERIFY')
    expect(demo.dirty).toBe(true)
    expect(demo.unverifiedRanges).toEqual([])
  })

  it('reports UNVERIFIED for a page created entirely after the verified prefix', async () => {
    const { c1 } = await buildFixture()
    await writeWikiReviewMark(root, c1)
    const marks = await readWikiReviewMarks(root)

    const beta = (await deriveWikiReview(root, [BETA], marks))!.get(BETA)!
    expect(beta.state).toBe('UNVERIFIED')
    expect(beta.unverifiedRanges).toEqual([[1, 20]])
    expect(beta.verifiedThrough).toBe(c1)
  })

  it('reports UNVERIFIED for an untracked new page', async () => {
    const { c1, c2, c3, c4 } = await buildFixture()
    for (const sha of [c1, c2, c3, c4]) await writeWikiReviewMark(root, sha)
    const marks = await readWikiReviewMarks(root)
    const fresh = 'docs/wiki/question/W0004-fresh.md'
    await writeRepoFile(fresh, page('W0004', 'question', 'fresh'))

    const review = (await deriveWikiReview(root, [fresh], marks))!.get(fresh)!
    expect(review.state).toBe('UNVERIFIED')
    expect(review.dirty).toBe(true)
    expect(review.unverifiedRanges).toEqual([[1, 20]])
  })
})

describe('outside a git worktree', () => {
  let plain: string

  beforeEach(async () => {
    plain = await mkdtemp(join(tmpdir(), 'memon-wiki-nogit-'))
    await mkdir(join(plain, 'docs/wiki/finding'), { recursive: true })
    await writeFile(
      join(plain, ALPHA),
      page('W0001', 'finding', 'alpha'),
      'utf8',
    )
  })
  afterEach(async () => {
    await rm(plain, { recursive: true, force: true })
  })

  it('returns null results and refuses to mark', async () => {
    expect(await isGitWorktree(plain)).toBe(false)
    expect(await listWikiCommits(plain)).toBeNull()
    expect(await deriveWikiReview(plain, [ALPHA], [])).toBeNull()
    expect(await readWikiReviewMarks(plain)).toEqual([])
    await expect(writeWikiReviewMark(plain, 'a'.repeat(40))).rejects.toMatchObject({
      code: 'NOT_GIT',
    })
  })
})

describe('configured execution runner', () => {
  /** Wraps the local runner so the argv of every wiki git read is observable. */
  function recordingRunner(): { exec: GitCommandRunner; argvs: string[][] } {
    const argvs: string[][] = []
    const exec: GitCommandRunner = (bin, args, execOpts) => {
      argvs.push([...args])
      return execFileGitCommand(bin, args, execOpts)
    }
    return { exec, argvs }
  }

  it('routes every wiki git read through the runner and derives the same review', async () => {
    const { c1, c2, c3, c4 } = await buildFixture()
    for (const sha of [c1, c2, c3]) await writeWikiReviewMark(root, sha)
    const marks = await readWikiReviewMarks(root)
    await rewriteLines(BETA, 10, 10, 'beta uncommitted')

    const { exec, argvs } = recordingRunner()
    const review = (await deriveWikiReview(root, [ALPHA, BETA, DEMO], marks, { exec }))!

    // Same verdicts the local path produces: ALPHA is covered through c3,
    // DEMO's asset moved in c4, BETA carries an uncommitted edit.
    expect(review.get(ALPHA)!.state).toBe('VERIFIED')
    expect(review.get(DEMO)!.state).toBe('CHANGED_SINCE_VERIFY')
    expect(review.get(DEMO)!.unverifiedCommits).toEqual([c4])
    expect(review.get(BETA)!.dirty).toBe(true)
    expect(review.get(BETA)!.unverifiedRanges).toEqual([[1, 20]])

    // Nothing bypassed the runner: the worktree probe, the wiki log, blame,
    // the dirty check and the bundle listing all arrived here, and every
    // invocation asks git not to take optional locks on the target.
    expect(new Set(argvs.map((argv) => argv[3]))).toEqual(
      new Set(['rev-parse', 'log', 'blame', 'status', 'ls-files']),
    )
    expect(argvs.every((argv) => argv[0] === '--no-optional-locks')).toBe(true)
  })

  it('refuses to certify a marked page when the dirty-state check fails', async () => {
    const { c1, c2, c3, c4 } = await buildFixture()
    for (const sha of [c1, c2, c3, c4]) await writeWikiReviewMark(root, sha)
    const marks = await readWikiReviewMarks(root)

    // Baseline: with a working status check the marked pages read VERIFIED.
    const clean = (await deriveWikiReview(root, [ALPHA, DEMO], marks))!
    expect(clean.get(ALPHA)!.state).toBe('VERIFIED')
    expect(clean.get(DEMO)!.state).toBe('VERIFIED')

    const statusBroken: GitCommandRunner = (bin, args, execOpts) =>
      args.includes('status')
        ? Promise.resolve({
            stdout: '',
            stderr: 'fatal: unable to read index file\n',
            code: 128,
          })
        : execFileGitCommand(bin, args, execOpts)

    await expect(
      deriveWikiReview(root, [ALPHA, DEMO], marks, { exec: statusBroken }),
    ).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' })
  })

  it('reports git as unavailable when the execution target cannot answer', async () => {
    await buildFixture()
    const unreachable: GitCommandRunner = () =>
      Promise.resolve({
        stdout: '',
        stderr: 'ssh: connect to host cluster port 22: Connection refused\r\n',
        code: 255,
      })
    const timedOut: GitCommandRunner = () =>
      Promise.resolve({ stdout: '', stderr: '', code: -1, timedOut: true })

    for (const exec of [unreachable, timedOut]) {
      await expect(listWikiCommits(root, { exec })).rejects.toMatchObject({
        code: 'GIT_UNAVAILABLE',
      })
      await expect(deriveWikiReview(root, [ALPHA], [], { exec })).rejects.toMatchObject({
        code: 'GIT_UNAVAILABLE',
      })
      await expect(
        writeWikiReviewMark(root, 'next', undefined, { exec }),
      ).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' })
      await expect(removeWikiReviewMark(root, 'a'.repeat(40), { exec })).rejects.toMatchObject({
        code: 'GIT_UNAVAILABLE',
      })
      // The tolerant boolean probe answers without claiming a worktree.
      expect(await isGitWorktree(root, { exec })).toBe(false)
    }
  })
})
