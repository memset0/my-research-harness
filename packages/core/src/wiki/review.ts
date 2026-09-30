// Wiki review — commit-ordered human verification of `docs/wiki/`.
//
// Trust in the wiki is recorded per *wiki commit* (any commit touching a
// path under `docs/wiki/`, bundle assets included), never per page. Marks
// live in `<projectRoot>/.memon/wiki-review.csv`:
//
//   sha,verified_at,note
//   <full 40-char SHA>,<ISO 8601 w/ offset>,<RFC 4180 quoted note>
//
// Rows are stored in commit order (oldest first) so git diffs of the file
// read like an append. This store is independent of the deprecated
// `.memon/commit-marks.csv` and is never consulted for it.
//
// Verification proceeds oldest → newest: a commit may be marked only when
// every older wiki commit is already marked (`WikiReviewOrderError`, which
// carries the next commit that *is* markable); removing a mark cascades to
// every newer mark.
//
// Per-page state is derived, not stored: `git blame --line-porcelain` on the
// page's Markdown file at HEAD gives the last-changing commit of every line,
// the wiki-commit log gives the last-changing commit of every bundle asset
// (assets count whole-file), and `git status --porcelain` gives uncommitted
// changes (a changed file is dirty and wholly unverified).
//
// Every git invocation goes through a `GitCommandRunner` with
// `cwd = projectRoot` and an argv array — never a shell string. A caller that
// passes `exec` (a project configured with a remote execution provider) gets
// every read — worktree probe, log, `show`, blame, `status`, `ls-files` —
// routed through that runner; omitting it uses the local transport below,
// which keeps the environment the local path has always set. Either runner is
// wrapped in `cachedGitCommand`, so the several reads one review derivation
// needs — and repeated derivations for the same project — share results
// instead of respawning git per call. Outside a git worktree the derived
// results are `null` (callers surface `review: null` / 404). When git itself
// cannot answer — missing binary, unreachable execution target, timeout, or a
// failing dirty-state check — the readers throw
// `WikiReviewError('GIT_UNAVAILABLE')`: an unreachable git must never be
// mistaken for a clean, fully verified wiki.

import { execFile } from 'node:child_process'
import {
  cachedGitCommand,
  gitCommandStdoutText,
  isGitCommandFailure,
  toGitExecFailure,
  type GitCommandResult,
  type GitCommandRunner,
  type GitExecFailure,
} from '../git/command.js'
import { projectFs } from '../project-file-store.js'
import { dirname as posixDirname, join as posixJoin } from 'node:path/posix'
import { dirname, join } from 'node:path'
import { formatIsoLocal } from '../time.js'
import { WIKI_DIR_RELPATH, type ReviewState, type WikiReview } from './types.js'

// The review store is project content: reads and writes go through the shared
// project file facade so they are cached, scheduled and read-only aware.
const { mkdir, readFile, rename, rm, writeFile } = projectFs

/** Path of the review store, relative to the project root. */
export const WIKI_REVIEW_RELPATH = '.memon/wiki-review.csv'

const CSV_HEADER = 'sha,verified_at,note'
const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER = 64 * 1024 * 1024
const FULL_SHA_REGEX = /^[0-9a-f]{40}$/
const PREFIX_SHA_REGEX = /^[0-9a-f]{4,40}$/
const WIKI_ID_IN_PATH_REGEX = /(?:^|\/)(W\d{4})(?:[-./]|$)/
const FRONTMATTER_ID_REGEX = /^id:[ \t]*["']?(W\d{4})["']?[ \t]*$/m
const BLAME_LINE_REGEX = /^([0-9a-f]{40}) \d+ (\d+)/
const UNIT_SEP = '\u001f'

// --- types ---------------------------------------------------------------

/** One row of `.memon/wiki-review.csv`. */
export interface WikiReviewMark {
  /** Full 40-character commit SHA. */
  sha: string
  /** ISO 8601 with timezone offset. */
  verifiedAt: string
  /** Free-form note; `''` when absent. */
  note: string
}

/** A commit touching `docs/wiki/`, as returned oldest-first by `listWikiCommits`. */
export interface WikiCommit {
  sha: string
  /** Author date, ISO 8601 with offset (`%aI`). */
  authoredAt: string
  subject: string
  /** Project-relative paths under `docs/wiki/` the commit touched. */
  files: string[]
  /** `W<NNNN>` ids the touched paths belong to, ascending. */
  pages: string[]
}

export type WikiReviewErrorCode =
  | 'REVIEW_ORDER'
  | 'NOT_GIT'
  | 'NOT_FOUND'
  /** Git could not answer at all: unreachable execution target, timeout, failing read. */
  | 'GIT_UNAVAILABLE'

export class WikiReviewError extends Error {
  readonly code: WikiReviewErrorCode

  constructor(code: WikiReviewErrorCode, message: string) {
    super(message)
    this.name = 'WikiReviewError'
    this.code = code
  }
}

/**
 * Thrown when a mark would skip an older unverified wiki commit.
 * `nextSha` is the oldest commit that may be marked right now.
 */
export class WikiReviewOrderError extends WikiReviewError {
  readonly nextSha: string | null

  constructor(nextSha: string | null) {
    super(
      'REVIEW_ORDER',
      nextSha
        ? `older wiki commits are unverified; verify ${nextSha} first`
        : 'older wiki commits are unverified',
    )
    this.name = 'WikiReviewOrderError'
    this.nextSha = nextSha
  }
}

export interface WikiReviewStoreOptions {
  /** Override the on-disk CSV path. Used by tests; production callers omit it. */
  csvPathOverride?: string
  /**
   * The command runner used for *every* git invocation of the review reader.
   * Projects whose files are only mounted locally configure one so git runs
   * where the repository lives. Omitted → the local transport below. Both are
   * wrapped in the shared git read cache.
   */
  exec?: GitCommandRunner
}

// --- git plumbing --------------------------------------------------------

interface GitResult {
  ok: boolean
  stdout: string
  /** Diagnostic of a failed invocation; absent when `ok`. */
  failure?: GitExecFailure
  /**
   * The command produced no answer *about the repository*: the binary or the
   * configured execution target could not be reached, or the invocation timed
   * out. Such a failure must never be read as "no repository" / "no matches"
   * / "nothing dirty".
   */
  unavailable?: boolean
}

/**
 * Transport breakage a remote runner reports as a plain non-zero exit (ssh
 * exits 255 with its own diagnostic on stderr) rather than a spawn failure.
 */
const TRANSPORT_FAILURE_REGEX =
  /(?:^|[\s"'])(?:ssh|scp|sshfs):|connection (?:closed|refused|reset|timed out)|connection to \S+ closed|closed by remote host|could not resolve hostname|name or service not known|no route to host|network is unreachable|host key verification failed|permission denied \(publickey|kex_exchange_identification|broken pipe|operation timed out|(?:command )?not found: git|git: (?:command )?not found|command not found/i

function isUnavailableFailure(failure: GitExecFailure): boolean {
  // Missing binary / unspawnable target, or killed by our own timeout.
  if (failure.err.code === 'ENOENT') return true
  if (failure.err.killed === true) return true
  return (
    TRANSPORT_FAILURE_REGEX.test(failure.stderr) ||
    TRANSPORT_FAILURE_REGEX.test(failure.err.message)
  )
}

/**
 * The local transport of the review reads: the shared `execFile` behaviour
 * plus the environment this path has always set — no credential prompt, and
 * `GIT_OPTIONAL_LOCKS=0` so a read never refreshes a live worktree's index.
 * (`GitCommandOptions` carries no environment, which is why this is a runner
 * of its own rather than `execFileGitCommand`.)
 */
const localGitCommand: GitCommandRunner = (bin, args, opts) =>
  new Promise<GitCommandResult>((resolve) => {
    execFile(
      bin,
      [...args],
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: opts.maxBuffer,
        windowsHide: true,
        encoding: opts.encoding === 'buffer' ? 'buffer' : 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      },
      (error, stdout, stderr) => {
        const stderrText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '')
        const stdoutValue =
          opts.encoding === 'buffer'
            ? Buffer.isBuffer(stdout)
              ? stdout
              : Buffer.from(String(stdout ?? ''), 'utf8')
            : Buffer.isBuffer(stdout)
              ? stdout.toString('utf8')
              : String(stdout ?? '')
        if (error === null) {
          resolve({ stdout: stdoutValue, stderr: stderrText, code: 0 })
          return
        }
        const spawnFailed = error.code === 'ENOENT'
        resolve({
          stdout: stdoutValue,
          stderr: stderrText,
          code: typeof error.code === 'number' ? error.code : spawnFailed ? -1 : 1,
          timedOut: error.killed === true,
          spawnFailed,
          message: error.message,
        })
      },
    )
  })

/** The local transport's cache. Its environment makes it its own namespace. */
const localReviewGit = cachedGitCommand(localGitCommand, 'wiki-review-local')

async function runGit(
  projectRoot: string,
  args: string[],
  opts: WikiReviewStoreOptions,
): Promise<GitResult> {
  // One transport for both paths: a configured runner carries no environment
  // (the command may cross an SSH boundary), so the index-lock suppression
  // `GIT_OPTIONAL_LOCKS=0` gives the local path is requested through argv for
  // everyone. Every command here is a read; none of them may refresh the
  // index of a live worktree.
  const exec = opts.exec ? cachedGitCommand(opts.exec) : localReviewGit
  const result = await exec('git', ['--no-optional-locks', '-c', 'core.quotePath=false', ...args], {
    cwd: projectRoot,
    timeoutMs: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  })
  const stdout = gitCommandStdoutText(result)
  if (!isGitCommandFailure(result)) return { ok: true, stdout }
  const failure = toGitExecFailure(result)
  return { ok: false, stdout, failure, unavailable: isUnavailableFailure(failure) }
}

/** The `GIT_UNAVAILABLE` error for a git read that could not answer. */
function gitUnavailable(projectRoot: string, what: string, r: GitResult): WikiReviewError {
  const detail = r.failure
    ? r.failure.stderr.trim() || r.failure.err.message.trim()
    : 'unknown failure'
  const short = detail.length > 200 ? `${detail.slice(0, 199)}…` : detail
  return new WikiReviewError(
    'GIT_UNAVAILABLE',
    `git ${what} is unavailable for ${projectRoot}: ${short || 'unknown failure'}`,
  )
}

/**
 * `true` inside a git worktree, `false` when `projectRoot` genuinely is not
 * one. Throws `WikiReviewError('GIT_UNAVAILABLE')` when git could not answer,
 * so an unreachable target never masquerades as "not a repository".
 */
async function requireGitWorktree(
  projectRoot: string,
  opts: WikiReviewStoreOptions,
): Promise<boolean> {
  const r = await runGit(projectRoot, ['rev-parse', '--is-inside-work-tree'], opts)
  if (r.unavailable) throw gitUnavailable(projectRoot, 'rev-parse', r)
  return r.ok && r.stdout.trim() === 'true'
}

/**
 * True when `projectRoot` is inside a git worktree and git is usable — a
 * tolerant probe: an unreachable git is reported as `false` like a missing
 * worktree. Callers needing the distinction use `listWikiCommits` /
 * `deriveWikiReview`, which throw `GIT_UNAVAILABLE`.
 */
export async function isGitWorktree(
  projectRoot: string,
  opts: WikiReviewStoreOptions = {},
): Promise<boolean> {
  try {
    return await requireGitWorktree(projectRoot, opts)
  } catch {
    return false
  }
}

// --- commit log ----------------------------------------------------------

/**
 * Every commit touching `docs/wiki/`, oldest first. `null` when
 * `projectRoot` is not a git worktree; `[]` for a worktree without
 * matching history (fresh repo, empty wiki). Throws
 * `WikiReviewError('GIT_UNAVAILABLE')` when git could not be reached.
 */
export async function listWikiCommits(
  projectRoot: string,
  opts: WikiReviewStoreOptions = {},
): Promise<WikiCommit[] | null> {
  if (!(await requireGitWorktree(projectRoot, opts))) return null
  const r = await runGit(
    projectRoot,
    [
      'log',
      '--reverse',
      `--format=%H${UNIT_SEP}%aI${UNIT_SEP}%s`,
      '--name-only',
      '--',
      WIKI_DIR_RELPATH,
    ],
    opts,
  )
  if (r.unavailable) throw gitUnavailable(projectRoot, 'log', r)
  // A worktree without commits (unborn HEAD) or without wiki history is not
  // an error for callers — it simply has no wiki commits yet.
  if (!r.ok) return []

  const commits: WikiCommit[] = []
  let current: WikiCommit | null = null
  for (const line of r.stdout.split('\n')) {
    if (line === '') continue
    if (line.includes(UNIT_SEP)) {
      const parts = line.split(UNIT_SEP)
      current = {
        sha: parts[0] ?? '',
        authoredAt: parts[1] ?? '',
        subject: parts.slice(2).join(UNIT_SEP),
        files: [],
        pages: [],
      }
      commits.push(current)
      continue
    }
    if (current) current.files.push(line)
  }

  // Page attribution: prefer the `W<NNNN>` token in the path (the canonical
  // `docs/wiki/<kind>/W<NNNN>-<slug>{.md,/…}` layout), and fall back to the
  // page frontmatter as it existed at that commit for legacy layouts.
  const frontmatterIds = new Map<string, string | null>()
  for (const commit of commits) {
    const ids = new Set<string>()
    for (const file of commit.files) {
      const fromPath = WIKI_ID_IN_PATH_REGEX.exec(file)?.[1]
      if (fromPath) {
        ids.add(fromPath)
        continue
      }
      const candidates = markdownCandidatesFor(file)
      for (const candidate of candidates) {
        const key = `${commit.sha}:${candidate}`
        let id = frontmatterIds.get(key)
        if (id === undefined) {
          id = await readIdAtCommit(projectRoot, commit.sha, candidate, opts)
          frontmatterIds.set(key, id)
        }
        if (id) {
          ids.add(id)
          break
        }
      }
    }
    commit.pages = [...ids].sort()
  }
  return commits
}

/**
 * Markdown files that could carry the id of `file`: the file itself when it
 * is Markdown, plus the `README.md` of each enclosing directory below
 * `docs/wiki/<kind>/` (bundle assets).
 */
function markdownCandidatesFor(file: string): string[] {
  const out: string[] = []
  if (file.endsWith('.md')) out.push(file)
  let dir = posixDirname(file)
  while (dir.startsWith(`${WIKI_DIR_RELPATH}/`) && dir !== WIKI_DIR_RELPATH) {
    const readme = posixJoin(dir, 'README.md')
    if (!out.includes(readme)) out.push(readme)
    dir = posixDirname(dir)
  }
  return out
}

async function readIdAtCommit(
  projectRoot: string,
  sha: string,
  path: string,
  opts: WikiReviewStoreOptions,
): Promise<string | null> {
  const r = await runGit(projectRoot, ['show', `${sha}:${path}`], opts)
  if (r.unavailable) throw gitUnavailable(projectRoot, 'show', r)
  // A missing path at that commit is the normal answer, not a failure.
  if (!r.ok) return null
  return FRONTMATTER_ID_REGEX.exec(r.stdout)?.[1] ?? null
}

// --- mark store ----------------------------------------------------------

/**
 * Read `.memon/wiki-review.csv`. Missing file → `[]`. Malformed rows are
 * skipped (the store is human-editable; a bad row must not break reads).
 */
export async function readWikiReviewMarks(
  projectRoot: string,
  opts: WikiReviewStoreOptions = {},
): Promise<WikiReviewMark[]> {
  const path = reviewCsvPath(projectRoot, opts)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return parseWikiReviewCsv(text)
}

/**
 * Mark `sha` (full SHA or unambiguous prefix, or `'next'`) verified.
 *
 * Throws `WikiReviewError('NOT_GIT')` outside a worktree,
 * `WikiReviewError('GIT_UNAVAILABLE')` when git could not be reached (the
 * commit order that gates the mark is then unknown),
 * `WikiReviewError('NOT_FOUND')` when no wiki commit matches, and
 * `WikiReviewOrderError` when an older wiki commit is still unverified.
 * Re-marking an already verified commit is idempotent (a new `note`
 * replaces the stored one).
 */
export async function writeWikiReviewMark(
  projectRoot: string,
  sha: string,
  note?: string,
  opts: WikiReviewStoreOptions = {},
): Promise<WikiReviewMark> {
  const commits = await listWikiCommits(projectRoot, opts)
  if (commits === null) {
    throw new WikiReviewError('NOT_GIT', `not a git worktree: ${projectRoot}`)
  }
  const marks = await readWikiReviewMarks(projectRoot, opts)
  const marked = new Set(marks.map((m) => m.sha))

  const target =
    sha === 'next'
      ? (commits.find((c) => !marked.has(c.sha)) ?? null)
      : resolveWikiCommit(commits, sha)
  if (!target) {
    throw new WikiReviewError(
      'NOT_FOUND',
      sha === 'next' ? 'every wiki commit is already verified' : `no wiki commit matches "${sha}"`,
    )
  }

  const targetIdx = commits.findIndex((c) => c.sha === target.sha)
  const gap = commits.slice(0, targetIdx).find((c) => !marked.has(c.sha))
  if (gap) throw new WikiReviewOrderError(gap.sha)

  const existing = marks.find((m) => m.sha === target.sha)
  if (existing) {
    if (note === undefined || note === existing.note) return existing
    existing.note = note
    existing.verifiedAt = formatIsoLocal(new Date())
    await writeMarks(reviewCsvPath(projectRoot, opts), marks, commits)
    return existing
  }

  const mark: WikiReviewMark = {
    sha: target.sha,
    verifiedAt: formatIsoLocal(new Date()),
    note: note ?? '',
  }
  marks.push(mark)
  await writeMarks(reviewCsvPath(projectRoot, opts), marks, commits)
  return mark
}

/**
 * Remove the mark for `sha` (full SHA or unambiguous prefix) and every
 * newer mark. Returns the removed SHAs oldest first and the resulting
 * `verifiedThrough`. Throws `WikiReviewError('GIT_UNAVAILABLE')` when git
 * could not be reached: without the commit order the cascade is unknowable.
 */
export async function removeWikiReviewMark(
  projectRoot: string,
  sha: string,
  opts: WikiReviewStoreOptions = {},
): Promise<{ removed: string[]; verifiedThrough: string | null }> {
  const commits = await listWikiCommits(projectRoot, opts)
  const marks = await readWikiReviewMarks(projectRoot, opts)
  const order = commitOrder(commits)

  const prefixMatches = PREFIX_SHA_REGEX.test(sha) ? marks.filter((m) => m.sha.startsWith(sha)) : []
  const target =
    marks.find((m) => m.sha === sha) ?? (prefixMatches.length === 1 ? prefixMatches[0] : undefined)
  if (!target) {
    return {
      removed: [],
      verifiedThrough: verifiedThroughMark(commits, marks)?.sha ?? null,
    }
  }

  const targetIdx = order.get(target.sha)
  const kept = marks.filter((m) => {
    if (m.sha === target.sha) return false
    if (targetIdx === undefined) return true
    const idx = order.get(m.sha)
    // Marks for commits that are no longer in the wiki log are left alone;
    // they carry no ordering information to cascade against.
    return idx === undefined ? true : idx < targetIdx
  })
  const removed = marks
    .filter((m) => !kept.includes(m))
    .sort((a, b) => (order.get(a.sha) ?? 0) - (order.get(b.sha) ?? 0))
    .map((m) => m.sha)

  await writeMarks(reviewCsvPath(projectRoot, opts), kept, commits)
  return {
    removed,
    verifiedThrough: verifiedThroughMark(commits, kept)?.sha ?? null,
  }
}

/**
 * The newest marked wiki commit — the end of the verified prefix. `null`
 * when nothing is marked (or no mark corresponds to a known wiki commit).
 */
export function verifiedThroughMark(
  commits: WikiCommit[] | null,
  marks: WikiReviewMark[],
): WikiReviewMark | null {
  const order = commitOrder(commits)
  let best: WikiReviewMark | null = null
  let bestIdx = -1
  for (const mark of marks) {
    const idx = order.get(mark.sha)
    if (idx === undefined) continue
    if (idx > bestIdx) {
      bestIdx = idx
      best = mark
    }
  }
  return best
}

function resolveWikiCommit(commits: WikiCommit[], sha: string): WikiCommit | undefined {
  const exact = commits.find((c) => c.sha === sha)
  if (exact) return exact
  if (!PREFIX_SHA_REGEX.test(sha)) return undefined
  const matches = commits.filter((c) => c.sha.startsWith(sha))
  return matches.length === 1 ? matches[0] : undefined
}

function commitOrder(commits: WikiCommit[] | null): Map<string, number> {
  const order = new Map<string, number>()
  if (!commits) return order
  commits.forEach((c, i) => {
    order.set(c.sha, i)
  })
  return order
}

function reviewCsvPath(projectRoot: string, opts: WikiReviewStoreOptions): string {
  return opts.csvPathOverride ?? join(projectRoot, WIKI_REVIEW_RELPATH)
}

async function writeMarks(
  path: string,
  marks: WikiReviewMark[],
  commits: WikiCommit[] | null,
): Promise<void> {
  const order = commitOrder(commits)
  const sorted = [...marks].sort((a, b) => {
    const ia = order.get(a.sha)
    const ib = order.get(b.sha)
    // Unknown commits sort last, by sha, so the file stays deterministic.
    if (ia === undefined && ib === undefined) return a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0
    if (ia === undefined) return 1
    if (ib === undefined) return -1
    return ia - ib
  })
  await mkdir(dirname(path), { recursive: true })
  const text = serializeWikiReviewCsv(sorted)
  const tmp = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path)
  } catch (err) {
    try {
      await rm(tmp, { force: true })
    } catch {
      /* swallow cleanup failure */
    }
    throw err
  }
}

// --- CSV (RFC 4180) ------------------------------------------------------

export function serializeWikiReviewCsv(marks: WikiReviewMark[]): string {
  const lines = [CSV_HEADER]
  for (const m of marks) {
    lines.push([m.sha, m.verifiedAt, quoteCsvField(m.note)].join(','))
  }
  return `${lines.join('\n')}\n`
}

export function parseWikiReviewCsv(text: string): WikiReviewMark[] {
  const records = parseCsvRecords(text)
  if (records.length === 0) return []
  if (records[0]!.join(',') !== CSV_HEADER) return []
  const marks: WikiReviewMark[] = []
  for (const fields of records.slice(1)) {
    if (fields.length !== 3) continue
    const sha = fields[0]!.trim()
    if (!FULL_SHA_REGEX.test(sha)) continue
    if (marks.some((m) => m.sha === sha)) continue
    marks.push({ sha, verifiedAt: fields[1]!.trim(), note: fields[2]! })
  }
  return marks
}

function quoteCsvField(s: string): string {
  if (s === '') return ''
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStartedQuoted = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"' && field === '' && !fieldStartedQuoted) {
      inQuotes = true
      fieldStartedQuoted = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      fieldStartedQuoted = false
      i += 1
      continue
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field)
      field = ''
      fieldStartedQuoted = false
      if (!(row.length === 1 && row[0] === '')) records.push(row)
      row = []
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += ch
    i += 1
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    records.push(row)
  }
  return records
}

// --- derivation ----------------------------------------------------------

interface PageTarget {
  /** Project-relative path of the page's Markdown file. */
  path: string
  /** Bundle directory when the page is a bundle (`…/README.md`), else null. */
  bundleDir: string | null
}

/**
 * Derive `review` for every page in `pagePaths` (project-relative paths of
 * the `.md` / `README.md` file). `null` when `projectRoot` is not a git
 * worktree — callers then report `review: null`. Throws
 * `WikiReviewError('GIT_UNAVAILABLE')` when a git read the verdict depends on
 * could not answer: a page whose dirty state is unknown must never be
 * reported as verified.
 */
export async function deriveWikiReview(
  projectRoot: string,
  pagePaths: string[],
  marks: WikiReviewMark[],
  opts: WikiReviewStoreOptions = {},
): Promise<Map<string, WikiReview> | null> {
  const commits = await listWikiCommits(projectRoot, opts)
  if (commits === null) return null

  const order = commitOrder(commits)
  const through = verifiedThroughMark(commits, marks)
  const throughIdx = through ? (order.get(through.sha) ?? -1) : -1
  const covered = (sha: string | undefined): boolean => {
    if (!sha) return false
    const idx = order.get(sha)
    return idx !== undefined && idx <= throughIdx
  }

  // Last-changing wiki commit of every tracked path, straight from the log.
  const lastChange = new Map<string, string>()
  for (const commit of commits) {
    for (const file of commit.files) lastChange.set(file, commit.sha)
  }

  const targets: PageTarget[] = pagePaths.map((raw) => {
    const path = raw.replace(/^\.\//, '').replace(/^\/+/, '')
    const bundleDir = path.endsWith('/README.md') ? posixDirname(path) : null
    return { path, bundleDir }
  })

  const changed = await readDirtyPaths(
    projectRoot,
    targets.flatMap((t) => (t.bundleDir ? [t.bundleDir] : [t.path])),
    opts,
  )

  const rows = await Promise.all(
    targets.map(async (target): Promise<[string, WikiReview]> => {
      const belongs = (file: string): boolean =>
        file === target.path ||
        (target.bundleDir !== null && file.startsWith(`${target.bundleDir}/`))

      const [blame, trackedAssets] = await Promise.all([
        blameLineShas(projectRoot, target.path, opts),
        target.bundleDir === null
          ? Promise.resolve([])
          : listTrackedFiles(projectRoot, target.bundleDir, opts),
      ])
      const dirtyPaths = [...changed].filter(belongs)
      const dirty = dirtyPaths.length > 0
      const markdownDirty = dirty && dirtyPaths.some((p) => p === target.path)

      let unverifiedRanges: [number, number][]
      let coveredLines = 0
      if (markdownDirty || blame === null) {
        // Uncommitted (or untracked) Markdown counts wholly unverified.
        const lines = await countFileLines(join(projectRoot, target.path))
        unverifiedRanges = lines > 0 ? [[1, lines]] : []
        coveredLines = blame === null ? 0 : blame.filter((s) => covered(s)).length
      } else {
        const unverifiedLines: number[] = []
        blame.forEach((sha, lineNo) => {
          if (lineNo === 0) return
          if (covered(sha)) coveredLines += 1
          else unverifiedLines.push(lineNo)
        })
        unverifiedRanges = toRanges(unverifiedLines)
      }

      let coveredAssets = 0
      let unverifiedAssets = 0
      const assets = trackedAssets
        .filter((file) => file !== target.path)
        .concat(dirtyPaths.filter((file) => file !== target.path))
      for (const asset of new Set(assets)) {
        if (changed.has(asset) || !covered(lastChange.get(asset))) unverifiedAssets += 1
        else coveredAssets += 1
      }

      const unverifiedCommits = commits
        .filter((commit, index) => index > throughIdx && commit.files.some(belongs))
        .map((commit) => commit.sha)

      const hasUnverified = unverifiedRanges.length > 0 || unverifiedAssets > 0 || dirty
      let state: ReviewState
      if (throughIdx < 0) state = 'UNVERIFIED'
      else if (!hasUnverified) state = 'VERIFIED'
      else if (coveredLines > 0 || coveredAssets > 0) state = 'CHANGED_SINCE_VERIFY'
      else state = 'UNVERIFIED'

      return [
        target.path,
        {
          state,
          verifiedThrough: through?.sha ?? null,
          verifiedAt: through?.verifiedAt ?? null,
          unverifiedCommits,
          unverifiedRanges,
          dirty,
        },
      ]
    }),
  )
  return new Map(rows)
}

/**
 * Last-changing commit SHA per 1-based line of `path` at HEAD, or `null`
 * when the path is not in HEAD. Index 0 is unused. A `null` here means "not
 * committed yet" — wholly unverified — so an unreachable git must throw
 * instead of borrowing that meaning.
 */
async function blameLineShas(
  projectRoot: string,
  path: string,
  opts: WikiReviewStoreOptions,
): Promise<string[] | null> {
  const r = await runGit(projectRoot, ['blame', '--line-porcelain', 'HEAD', '--', path], opts)
  if (r.unavailable) throw gitUnavailable(projectRoot, 'blame', r)
  // Untracked path, unborn HEAD, or a path absent from HEAD: not in history.
  if (!r.ok) return null
  const shas: string[] = []
  for (const line of r.stdout.split('\n')) {
    const m = BLAME_LINE_REGEX.exec(line)
    if (m) shas[Number(m[2])] = m[1]!
  }
  return shas
}

/**
 * Paths with uncommitted changes (staged, unstaged, or untracked).
 *
 * Any failure throws: an empty set is indistinguishable from "everything is
 * clean" and would let a stale mark certify a page whose working copy was
 * never inspected.
 */
async function readDirtyPaths(
  projectRoot: string,
  pathspecs: string[],
  opts: WikiReviewStoreOptions,
): Promise<Set<string>> {
  const changed = new Set<string>()
  if (pathspecs.length === 0) return changed
  const r = await runGit(
    projectRoot,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...[...new Set(pathspecs)]],
    opts,
  )
  if (!r.ok) throw gitUnavailable(projectRoot, 'status', r)
  const tokens = r.stdout.split('\0')
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (token.length < 4) continue
    const xy = token.slice(0, 2)
    changed.add(token.slice(3))
    // Rename/copy entries carry the source path as the next NUL field.
    if (xy.includes('R') || xy.includes('C')) {
      const src = tokens[i + 1]
      if (src) {
        changed.add(src)
        i += 1
      }
    }
  }
  return changed
}

/**
 * Tracked files under `dir` (bundle assets). Any failure throws: `ls-files`
 * reports "no matches" with exit 0, so an empty result from a *failed* run
 * would silently drop unverified assets from the verdict.
 */
async function listTrackedFiles(
  projectRoot: string,
  dir: string,
  opts: WikiReviewStoreOptions,
): Promise<string[]> {
  const r = await runGit(projectRoot, ['ls-files', '-z', '--', dir], opts)
  if (!r.ok) throw gitUnavailable(projectRoot, 'ls-files', r)
  return r.stdout.split('\0').filter((p) => p !== '')
}

async function countFileLines(path: string): Promise<number> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return 0
  }
  if (text === '') return 0
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.length
}

function toRanges(lines: number[]): [number, number][] {
  const sorted = [...lines].sort((a, b) => a - b)
  const ranges: [number, number][] = []
  for (const line of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && line === last[1] + 1) last[1] = line
    else ranges.push([line, line])
  }
  return ranges
}
