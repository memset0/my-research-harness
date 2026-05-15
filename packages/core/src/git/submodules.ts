// Per-project submodule listing.
//
// Parses `.gitmodules` via `git config --file .gitmodules --get-regexp
// '^submodule\\..+\\.path$'` (which emits one line per submodule: the
// fully-qualified config key plus the path value). The submodule's NAME
// is the value between the leading `submodule.` and the trailing
// `.path`; the path is the value after the space.

import { execFile, type ExecFileException } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 5000

export interface GitSubmoduleEntry {
  /** Value inside `[submodule "<name>"]` in `.gitmodules`. */
  name: string
  /** Relative path from the project root. */
  path: string
}

export type GitSubmodules =
  | {
      enabled: false
      reason:
        | 'not-a-repo'
        | 'no-gitmodules'
        | 'git-not-found'
        | 'timeout'
        | 'error'
      message?: string
    }
  | {
      enabled: true
      submodules: GitSubmoduleEntry[]
    }

export interface ReadGitSubmodulesOptions {
  timeoutMs?: number
  gitBin?: string
}

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
        maxBuffer: 4 * 1024 * 1024,
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

export async function readGitSubmodules(
  projectRoot: string,
  opts: ReadGitSubmodulesOptions = {},
): Promise<GitSubmodules> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bin = opts.gitBin ?? 'git'

  // First verify this is a git repo at all — `git config --file` doesn't
  // care about cwd's git state, so we need this probe up front.
  const probe = await runGit(
    bin,
    ['rev-parse', '--is-inside-work-tree'],
    projectRoot,
    timeoutMs,
  )
  if (!probe.ok) {
    return classifyFail(probe)
  }

  const res = await runGit(
    bin,
    [
      'config',
      '--file',
      '.gitmodules',
      '--get-regexp',
      '^submodule\\..+\\.path$',
    ],
    projectRoot,
    timeoutMs,
  )
  if (!res.ok) {
    // `git config --get-regexp` exits with code 1 when no matches OR when
    // the file doesn't exist (without writing to stderr). Treat as
    // "no submodules" — empty list is valid output.
    const e = res.err
    if (e.code === 'ENOENT') {
      return { enabled: false, reason: 'git-not-found' }
    }
    if (e.killed) {
      return { enabled: false, reason: 'timeout' }
    }
    // Exit 1 with empty stderr = no matching keys / file absent. That's
    // a normal "no submodules" outcome.
    if (
      (typeof e.code === 'number' ? e.code : Number.parseInt(String(e.code ?? '0'), 10)) === 1 &&
      res.stderr.trim() === ''
    ) {
      return { enabled: true, submodules: [] }
    }
    return classifyFail(res)
  }

  const submodules: GitSubmoduleEntry[] = []
  for (const rawLine of res.stdout.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    // Line format: `submodule.<name>.path <relative-path>`
    const spaceIdx = line.indexOf(' ')
    if (spaceIdx === -1) continue
    const key = line.slice(0, spaceIdx)
    const path = line.slice(spaceIdx + 1)
    if (!key.startsWith('submodule.') || !key.endsWith('.path')) continue
    const name = key.slice('submodule.'.length, -'.path'.length)
    if (!name || !path) continue
    submodules.push({ name, path })
  }

  return { enabled: true, submodules }
}

function classifyFail(fail: ExecFail): GitSubmodules {
  const e = fail.err
  if (e.code === 'ENOENT') return { enabled: false, reason: 'git-not-found' }
  if (e.killed) return { enabled: false, reason: 'timeout' }
  if (/not a git repository/i.test(fail.stderr)) {
    return { enabled: false, reason: 'not-a-repo' }
  }
  return {
    enabled: false,
    reason: 'error',
    message: truncate(fail.stderr.trim() || e.message || 'git failed', 200),
  }
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max - 1) + '…'
}
