// Git history readers used by the dashboard's git-history dialog.
//
// Three concrete entry points:
// - `readGitBranches(cwd)` — local branch list + current HEAD info.
// - `readGitLog(cwd, { ref, limit })` — newest-first commit summaries on
//   a ref.
// - `readGitCommit(cwd, sha)` — one commit's metadata + per-file status
//   list (no contents — those come through `readGitFileContents`).
//
// All readers go through the shared git command seam (argv arrays, no
// shell) wrapped in `cachedGitCommand`, so repeated dialog reads of the
// same repository reuse one short-lived result. Callers MUST validate any
// user-provided ref / sha before invoking — the readers pass them verbatim
// to git.

import {
  cachedGitCommand,
  type GitCommandRunner,
  gitCommandStdoutText,
  isGitCommandFailure,
  toGitExecFailure,
} from './command.js'

import type { GitFileEntry, GitFileStatus } from './files.js'

const DEFAULT_TIMEOUT_MS = 5000

// --- types ---------------------------------------------------------------

export interface GitBranchEntry {
  name: string
  sha: string
  isCurrent: boolean
}

export type GitBranches =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | {
      enabled: true
      current: string | null
      detached: boolean
      sha: string
      branches: GitBranchEntry[]
    }

export interface GitCommitSummary {
  sha: string
  shortSha: string
  subject: string
  authorName: string
  authorEmail: string
  authorDate: string
  parents: string[]
}

export type GitLog =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | { enabled: true; commits: GitCommitSummary[] }

export type GitRange =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | {
      enabled: true
      from: string
      to: string
      commits: GitCommitSummary[]
      files: GitFileEntry[]
    }

export type GitCommitDetail =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'not-found' | 'error'
      message?: string
    }
  | {
      enabled: true
      sha: string
      shortSha: string
      subject: string
      body: string
      authorName: string
      authorEmail: string
      authorDate: string
      parents: string[]
      files: GitFileEntry[]
    }

export interface ReadGitHistoryOptions {
  timeoutMs?: number
  gitBin?: string
  /**
   * The command runner used for every git invocation. Defaults to the local
   * transport; either way the readers wrap it in the shared read cache.
   */
  exec?: GitCommandRunner
}

// --- exec helper ---------------------------------------------------------

interface ExecOk {
  ok: true
  stdout: string
  stderr: string
}
interface ExecFail {
  ok: false
  err: { code?: string | number; killed?: boolean; message: string }
  stderr: string
}

async function runGit(
  exec: GitCommandRunner,
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<ExecOk | ExecFail> {
  const result = await exec(bin, args, { cwd, timeoutMs, maxBuffer: 8 * 1024 * 1024 })
  if (isGitCommandFailure(result)) {
    return { ok: false, ...toGitExecFailure(result) }
  }
  return { ok: true, stdout: gitCommandStdoutText(result), stderr: result.stderr }
}

function classifyEnabledFalseError(fail: ExecFail): {
  reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
  message?: string
} {
  if (fail.err.code === 'ENOENT') return { reason: 'git-not-found' }
  if (fail.err.killed) return { reason: 'timeout' }
  if (/not a git repository/i.test(fail.stderr)) return { reason: 'not-a-repo' }
  return {
    reason: 'error',
    message: truncate(fail.stderr.trim() || fail.err.message || 'git failed', 200),
  }
}

function isUnknownRevisionStderr(s: string): boolean {
  return (
    /unknown revision/i.test(s) ||
    /ambiguous argument/i.test(s) ||
    /bad revision/i.test(s) ||
    /bad object/i.test(s) ||
    /no such object/i.test(s) ||
    /Not a valid object name/i.test(s)
  )
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max - 1) + '…'
}

// --- readGitBranches -----------------------------------------------------

export async function readGitBranches(
  cwd: string,
  opts: ReadGitHistoryOptions = {},
): Promise<GitBranches> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bin = opts.gitBin ?? 'git'
  const exec = cachedGitCommand(opts.exec)

  const headSha = await runGit(exec, bin, ['rev-parse', '--short', 'HEAD'], cwd, timeoutMs)
  if (!headSha.ok) {
    return { enabled: false, ...classifyEnabledFalseError(headSha) }
  }
  const sha = headSha.stdout.trim()

  // symbolic-ref exits non-zero when detached; that's not an error.
  const sym = await runGit(exec, bin, ['symbolic-ref', '--short', '-q', 'HEAD'], cwd, timeoutMs)
  let current: string | null = null
  let detached = false
  if (sym.ok) {
    current = sym.stdout.trim() || null
  } else {
    // Distinguish "detached HEAD" (exit 1, empty stdout) from real failures.
    detached = true
    current = null
  }

  const branchesRes = await runGit(
    exec,
    bin,
    ['for-each-ref', 'refs/heads', '--format=%(refname:short)%00%(objectname:short)%00%(HEAD)'],
    cwd,
    timeoutMs,
  )
  if (!branchesRes.ok) {
    return { enabled: false, ...classifyEnabledFalseError(branchesRes) }
  }

  const branches: GitBranchEntry[] = []
  for (const rawLine of branchesRes.stdout.split('\n')) {
    if (!rawLine) continue
    const parts = rawLine.split('\0')
    if (parts.length < 3) continue
    const [name, branchSha, headMarker] = parts as [string, string, string]
    branches.push({
      name,
      sha: branchSha,
      isCurrent: headMarker === '*',
    })
  }

  return { enabled: true, current, detached, sha, branches }
}

// --- readGitLog ----------------------------------------------------------

const LOG_FORMAT = '%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%s%x1e'

export async function readGitLog(
  cwd: string,
  options: { ref: string; limit: number },
  opts: ReadGitHistoryOptions = {},
): Promise<GitLog> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bin = opts.gitBin ?? 'git'
  const exec = cachedGitCommand(opts.exec)

  const res = await runGit(
    exec,
    bin,
    ['log', options.ref, `--max-count=${options.limit}`, `--format=${LOG_FORMAT}`],
    cwd,
    timeoutMs,
  )
  if (!res.ok) {
    return { enabled: false, ...classifyEnabledFalseError(res) }
  }

  const commits: GitCommitSummary[] = []
  // Records are split by `\x1e` (RS); each record holds NUL-delimited fields.
  for (const rawRecord of res.stdout.split('\x1e')) {
    const rec = rawRecord.replace(/^\n+/, '') // drop leading newlines between records
    if (!rec) continue
    const parts = rec.split('\0')
    if (parts.length < 7) continue
    const [sha, shortSha, authorName, authorEmail, authorDate, parentsRaw, subject] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    commits.push({
      sha,
      shortSha,
      subject,
      authorName,
      authorEmail,
      authorDate,
      parents: parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [],
    })
  }

  return { enabled: true, commits }
}

// --- readGitCommit -------------------------------------------------------

const COMMIT_FORMAT = '%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%s%x00%b'

export async function readGitCommit(
  cwd: string,
  sha: string,
  opts: ReadGitHistoryOptions = {},
): Promise<GitCommitDetail> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bin = opts.gitBin ?? 'git'
  const exec = cachedGitCommand(opts.exec)

  const metaRes = await runGit(
    exec,
    bin,
    ['show', '--no-patch', `--format=${COMMIT_FORMAT}`, sha],
    cwd,
    timeoutMs,
  )
  if (!metaRes.ok) {
    if (isUnknownRevisionStderr(metaRes.stderr)) {
      return { enabled: false, reason: 'not-found' }
    }
    return { enabled: false, ...classifyEnabledFalseError(metaRes) }
  }
  const parts = metaRes.stdout.split('\0')
  if (parts.length < 8) {
    return {
      enabled: false,
      reason: 'error',
      message: 'git show output unparseable',
    }
  }
  const [fullSha, shortSha, authorName, authorEmail, authorDate, parentsRaw, subject, bodyTail] =
    parts as [string, string, string, string, string, string, string, string]

  // The %b body ends with the trailing newline git appends after %b; strip it.
  const body = bodyTail.replace(/\n+$/, '')

  const filesRes = await runGit(
    exec,
    bin,
    ['diff-tree', '-r', '--root', '--raw', '-M', sha],
    cwd,
    timeoutMs,
  )
  if (!filesRes.ok) {
    if (isUnknownRevisionStderr(filesRes.stderr)) {
      return { enabled: false, reason: 'not-found' }
    }
    return { enabled: false, ...classifyEnabledFalseError(filesRes) }
  }

  const files = parseDiffTreeRaw(filesRes.stdout)

  return {
    enabled: true,
    sha: fullSha,
    shortSha,
    subject,
    body,
    authorName,
    authorEmail,
    authorDate,
    parents: parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [],
    files,
  }
}

/**
 * Parse `git diff-tree -r --raw` output.
 *
 * Each non-commit-id line looks like:
 *
 *   :<oldMode> <newMode> <oldSha> <newSha> <status>\t<path>[\t<origPath>]
 *
 * - The leading commit-id line (when `--no-commit-id` isn't passed) has no
 *   tab and is skipped.
 * - For rename / copy entries (status starts with `R` or `C`), there is a
 *   second tab and an `<origPath>` segment after `<path>` — wait, git's
 *   actual raw format puts `<origPath>` BEFORE `<path>` for renames. Both
 *   styles appear in git docs; the empirical layout matches name-status:
 *   `R<score>\t<old>\t<new>`.
 * - For submodule pointer changes, BOTH modes are `160000` (gitlink). The
 *   `<oldSha>` and `<newSha>` columns are the SUBMODULE's own commit SHAs.
 *   We populate `entry.submoduleBump = { fromSha, toSha }` in that case.
 */
export function parseDiffTreeRaw(stdout: string): GitFileEntry[] {
  const out: GitFileEntry[] = []
  for (const rawLine of stdout.split('\n')) {
    if (!rawLine) continue
    if (!rawLine.startsWith(':')) continue // leading commit-id or stray
    const tab = rawLine.indexOf('\t')
    if (tab === -1) continue
    const header = rawLine.slice(1, tab) // drop leading ':'
    const rest = rawLine.slice(tab + 1)
    // Header: `<oldMode> <newMode> <oldSha> <newSha> <status>`
    const headerParts = header.split(' ')
    if (headerParts.length < 5) continue
    const [oldMode, newMode, oldSha, newSha, statusCode] = headerParts as [
      string,
      string,
      string,
      string,
      string,
    ]
    if (!statusCode) continue
    const statusHead = statusCode[0]!
    let path: string
    let origPath: string | undefined
    if (statusHead === 'R' || statusHead === 'C') {
      // `<origPath>\t<newPath>` after the status header.
      const sep = rest.indexOf('\t')
      if (sep === -1) continue
      origPath = rest.slice(0, sep)
      path = rest.slice(sep + 1)
    } else {
      path = rest
    }
    const entry: GitFileEntry = {
      path,
      status: statusFromCode(statusHead),
      ...(origPath !== undefined ? { origPath } : {}),
    }
    if (oldMode === '160000' && newMode === '160000') {
      entry.submoduleBump = { fromSha: oldSha, toSha: newSha }
    }
    out.push(entry)
  }
  return out
}

export function parseDiffTreeNameStatus(stdout: string): GitFileEntry[] {
  const out: GitFileEntry[] = []
  const lines = stdout.split('\n')
  // The first non-empty line is the commit SHA when `--no-commit-id` is NOT
  // passed; we pass it implicitly via `-r` + `--name-status`. In practice
  // diff-tree without `--no-commit-id` prints a leading SHA line — skip
  // anything that doesn't look like a status code + tab.
  for (const rawLine of lines) {
    if (!rawLine) continue
    const tab = rawLine.indexOf('\t')
    if (tab === -1) continue // probably the leading commit SHA
    const code = rawLine.slice(0, tab)
    const rest = rawLine.slice(tab + 1)
    if (!code) continue
    const head = code[0]!
    if (head === 'R' || head === 'C') {
      // `R100\told\tnew` (or `C90` etc.)
      const sep = rest.indexOf('\t')
      if (sep === -1) continue
      const origPath = rest.slice(0, sep)
      const path = rest.slice(sep + 1)
      out.push({
        path,
        origPath,
        status: head === 'R' ? 'renamed' : 'copied',
      })
    } else {
      out.push({
        path: rest,
        status: statusFromCode(head),
      })
    }
  }
  return out
}

// --- readGitRange --------------------------------------------------------

export async function readGitRange(
  cwd: string,
  options: { from: string; to: string },
  opts: ReadGitHistoryOptions = {},
): Promise<GitRange> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bin = opts.gitBin ?? 'git'
  const exec = cachedGitCommand(opts.exec)

  const range = `${options.from}..${options.to}`

  const logRes = await runGit(exec, bin, ['log', range, `--format=${LOG_FORMAT}`], cwd, timeoutMs)
  if (!logRes.ok) {
    if (isUnknownRevisionStderr(logRes.stderr)) {
      return { enabled: false, reason: 'error', message: 'unknown revision' }
    }
    return { enabled: false, ...classifyEnabledFalseError(logRes) }
  }

  const commits: GitCommitSummary[] = []
  for (const rawRecord of logRes.stdout.split('\x1e')) {
    const rec = rawRecord.replace(/^\n+/, '')
    if (!rec) continue
    const parts = rec.split('\0')
    if (parts.length < 7) continue
    const [sha, shortSha, authorName, authorEmail, authorDate, parentsRaw, subject] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    commits.push({
      sha,
      shortSha,
      subject,
      authorName,
      authorEmail,
      authorDate,
      parents: parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [],
    })
  }

  const filesRes = await runGit(
    exec,
    bin,
    ['diff-tree', '-r', '--root', '--raw', '-M', range],
    cwd,
    timeoutMs,
  )
  if (!filesRes.ok) {
    if (isUnknownRevisionStderr(filesRes.stderr)) {
      return { enabled: false, reason: 'error', message: 'unknown revision' }
    }
    return { enabled: false, ...classifyEnabledFalseError(filesRes) }
  }
  const files = parseDiffTreeRaw(filesRes.stdout)

  return {
    enabled: true,
    from: options.from,
    to: options.to,
    commits,
    files,
  }
}

function statusFromCode(c: string): GitFileStatus {
  switch (c) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    default:
      return 'modified'
  }
}
