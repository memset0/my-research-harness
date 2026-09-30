// Git working-tree status reader.
//
// Polls `git status --porcelain=v2 --branch --ignore-submodules=all` through
// the shared git command seam and reduces the output to a small, stable
// struct. All failure modes (missing git, non-repo cwd, timeout, parse
// failure) collapse to a `{ enabled: false, reason }` shape so callers can
// early-return without special-casing exceptions.
//
// Every invocation goes through `cachedGitCommand`, so repeated polls of the
// same repository share one short-lived read instead of respawning git (or
// crossing an SSH boundary) per caller.

import {
  cachedGitCommand,
  type GitCommandRunner,
  type GitExecFailure,
  gitCommandStdoutText,
  isGitCommandFailure,
  toGitExecFailure,
} from './command.js'

const DEFAULT_TIMEOUT_MS = 3000

export type GitStatus =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | {
      enabled: true
      branch: string | null
      detached: boolean
      sha: string
      upstream: string | null
      ahead: number
      behind: number
      staged: number
      unstaged: number
      untracked: number
      dirty: boolean
    }

export interface ReadGitStatusOptions {
  /** Per-invocation timeout in milliseconds. Defaults to 3000. */
  timeoutMs?: number
  /** Override the git binary path (used by tests). Defaults to 'git'. */
  gitBin?: string
  /**
   * The command runner used for every git invocation. Defaults to the local
   * transport; either way the reader wraps it in the shared read cache.
   */
  exec?: GitCommandRunner
}

export async function readGitStatus(
  cwd: string,
  opts: ReadGitStatusOptions = {},
): Promise<GitStatus> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bin = opts.gitBin ?? 'git'
  const exec = cachedGitCommand(opts.exec)

  const result = await exec(
    bin,
    ['status', '--porcelain=v2', '--branch', '--ignore-submodules=all'],
    { cwd, timeoutMs, maxBuffer: 1_048_576 },
  )
  if (isGitCommandFailure(result)) {
    return classifyExecError(toGitExecFailure(result))
  }
  try {
    return parsePorcelainV2(gitCommandStdoutText(result))
  } catch (parseErr) {
    return {
      enabled: false,
      reason: 'error',
      message: truncate((parseErr as Error).message ?? String(parseErr), 200),
    }
  }
}

function classifyExecError(failure: GitExecFailure): GitStatus {
  const { err, stderr } = failure
  // Spawn-level failure: ENOENT means the git binary wasn't found.
  if (err.code === 'ENOENT') {
    return { enabled: false, reason: 'git-not-found' }
  }
  // Timeout: execFile sets `killed = true` when SIGTERM kills the child
  // because the timeout fired.
  if (err.killed) {
    return { enabled: false, reason: 'timeout' }
  }
  // Otherwise it's a non-zero exit. Git emits "fatal: not a git repository"
  // to stderr when run outside a working tree.
  if (/not a git repository/i.test(stderr)) {
    return { enabled: false, reason: 'not-a-repo' }
  }
  return {
    enabled: false,
    reason: 'error',
    message: truncate(stderr.trim() || err.message || 'git failed', 200),
  }
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max - 1) + '…'
}

// --- porcelain v2 parser ----------------------------------------------------

export function parsePorcelainV2(stdout: string): GitStatus {
  let branch: string | null = null
  let detached = false
  let sha = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let staged = 0
  let unstaged = 0
  let untracked = 0

  for (const rawLine of stdout.split('\n')) {
    if (!rawLine) continue
    if (rawLine.startsWith('# branch.oid ')) {
      const v = rawLine.slice('# branch.oid '.length).trim()
      sha = v === '(initial)' ? '' : v.slice(0, 7)
    } else if (rawLine.startsWith('# branch.head ')) {
      const v = rawLine.slice('# branch.head '.length).trim()
      if (v === '(detached)') {
        detached = true
        branch = null
      } else {
        branch = v
        detached = false
      }
    } else if (rawLine.startsWith('# branch.upstream ')) {
      upstream = rawLine.slice('# branch.upstream '.length).trim()
    } else if (rawLine.startsWith('# branch.ab ')) {
      const v = rawLine.slice('# branch.ab '.length).trim()
      const m = v.match(/^([+-]\d+)\s+([+-]\d+)$/)
      if (m) {
        ahead = Math.abs(parseInt(m[1]!, 10))
        behind = Math.abs(parseInt(m[2]!, 10))
      }
    } else if (rawLine.startsWith('1 ') || rawLine.startsWith('2 ')) {
      // `1 XY ...` (changed) or `2 XY ...` (renamed/copied). XY is two
      // chars: index status (staged) + worktree status (unstaged). `.`
      // means "unchanged in that column".
      const xy = rawLine.slice(2, 4)
      if (xy[0] && xy[0] !== '.') staged++
      if (xy[1] && xy[1] !== '.') unstaged++
    } else if (rawLine.startsWith('u ')) {
      // Unmerged (conflict) — counts as both staged and unstaged so the
      // file shows up in both numbers (matches what most git plugins do).
      staged++
      unstaged++
    } else if (rawLine.startsWith('? ')) {
      untracked++
    }
    // `! ...` ignored files — skip.
    // Anything else — skip silently.
  }

  return {
    enabled: true,
    branch,
    detached,
    sha,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    dirty: staged + unstaged + untracked > 0,
  }
}
