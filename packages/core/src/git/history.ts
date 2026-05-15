// Git history readers used by the dashboard's git-history dialog.
//
// Three concrete entry points:
// - `readGitBranches(cwd)` — local branch list + current HEAD info.
// - `readGitLog(cwd, { ref, limit })` — newest-first commit summaries on
//   a ref.
// - `readGitCommit(cwd, sha)` — one commit's metadata + per-file status
//   list (no contents — those come through `readGitFileContents`).
//
// All readers shell out via `execFile` (no shell). Callers MUST validate
// any user-provided ref / sha before invoking — the readers pass them
// verbatim to git.

import { execFile, type ExecFileException } from 'node:child_process'

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
}

// --- exec helper ---------------------------------------------------------

interface ExecOk {
  ok: true
  stdout: string
  stderr: string
}
interface ExecFail {
  ok: false
  err: ExecFileException & { code?: string | number; killed?: boolean }
  stderr: string
}

function runGit(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<ExecOk | ExecFail> {
  return new Promise((resolveP) => {
    execFile(
      bin,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          resolveP({
            ok: false,
            err: err as ExecFail['err'],
            stderr: String(stderr ?? ''),
          })
          return
        }
        resolveP({
          ok: true,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        })
      },
    )
  })
}

function classifyEnabledFalseError(
  fail: ExecFail,
): { reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'; message?: string } {
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

  const headSha = await runGit(bin, ['rev-parse', '--short', 'HEAD'], cwd, timeoutMs)
  if (!headSha.ok) {
    return { enabled: false, ...classifyEnabledFalseError(headSha) }
  }
  const sha = headSha.stdout.trim()

  // symbolic-ref exits non-zero when detached; that's not an error.
  const sym = await runGit(bin, ['symbolic-ref', '--short', '-q', 'HEAD'], cwd, timeoutMs)
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
    bin,
    [
      'for-each-ref',
      'refs/heads',
      '--format=%(refname:short)%00%(objectname:short)%00%(HEAD)',
    ],
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

  const res = await runGit(
    bin,
    [
      'log',
      options.ref,
      `--max-count=${options.limit}`,
      `--format=${LOG_FORMAT}`,
    ],
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
    const [sha, shortSha, authorName, authorEmail, authorDate, parentsRaw, subject] =
      parts as [string, string, string, string, string, string, string]
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

  const metaRes = await runGit(
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
  const [
    fullSha,
    shortSha,
    authorName,
    authorEmail,
    authorDate,
    parentsRaw,
    subject,
    bodyTail,
  ] = parts as [string, string, string, string, string, string, string, string]

  // The %b body ends with the trailing newline git appends after %b; strip it.
  const body = bodyTail.replace(/\n+$/, '')

  const filesRes = await runGit(
    bin,
    ['diff-tree', '-r', '--root', '--name-status', '-M', sha],
    cwd,
    timeoutMs,
  )
  if (!filesRes.ok) {
    if (isUnknownRevisionStderr(filesRes.stderr)) {
      return { enabled: false, reason: 'not-found' }
    }
    return { enabled: false, ...classifyEnabledFalseError(filesRes) }
  }

  const files = parseDiffTreeNameStatus(filesRes.stdout)

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
