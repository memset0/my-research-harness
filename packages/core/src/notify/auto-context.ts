// Auto-collected context for `memon notify` footers: agent kind detect,
// $HOME → ~ collapse, git branch probe, ISO8601-with-local-TZ timestamp.

import { spawn } from 'node:child_process'
import { AGENT_KIND_RE } from './telegram.js'

export class AgentKindError extends Error {
  constructor(public readonly value: string) {
    super(
      `--agent must match ${AGENT_KIND_RE.source} (got: ${JSON.stringify(value)})`,
    )
    this.name = 'AgentKindError'
  }
}

/**
 * Resolve the `agent` field for the footer.
 *
 * Precedence:
 *   1. `explicit` (from `--agent <kind>`) — validated against
 *      AGENT_KIND_RE; throws AgentKindError on mismatch.
 *   2. `env.CLAUDECODE` non-empty → 'claude'.
 *   3. `'unknown'` (literal).
 *
 * Other tool-specific env vars (CODEX_HOME, OPENCODE_*) are NOT
 * probed — they commonly sit in shell profiles and would yield
 * false positives. See openspec/specs/telegram-notify D11.
 */
export function detectAgent(
  env: NodeJS.ProcessEnv,
  explicit?: string,
): string {
  if (explicit !== undefined && explicit !== '') {
    if (!AGENT_KIND_RE.test(explicit)) {
      throw new AgentKindError(explicit)
    }
    return explicit
  }
  if (env.CLAUDECODE && env.CLAUDECODE !== '') return 'claude'
  return 'unknown'
}

/**
 * Collapse `$HOME` prefix in `cwd` to `~`. Idempotent on inputs that
 * don't start with `home`, and no-op when `home` is undefined.
 */
export function collapseHome(cwd: string, home: string | undefined): string {
  if (!home) return cwd
  // Match `home` exactly, OR `home/` followed by something. Never
  // collapse a partial prefix (e.g. `/home/alice2` should not be
  // collapsed under HOME=/home/alice).
  if (cwd === home) return '~'
  if (cwd.startsWith(home + '/')) return '~' + cwd.slice(home.length)
  return cwd
}

export interface GitBranchInfo {
  branch: string
  shortSha: string
}

/**
 * Best-effort probe of the current branch and short HEAD sha. Returns
 * `undefined` when:
 *   - cwd is not in a git work-tree
 *   - `git` is not on PATH
 *   - the subprocess exits non-zero
 *   - the timeout fires (default 1000 ms)
 *
 * Never throws.
 */
export async function probeGitBranch(
  cwd: string,
  timeoutMs = 1000,
): Promise<GitBranchInfo | undefined> {
  const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, timeoutMs)
  if (branch === undefined) return undefined
  const sha = await runGit(['rev-parse', '--short', 'HEAD'], cwd, timeoutMs)
  if (sha === undefined) return undefined
  return { branch: branch.trim(), shortSha: sha.trim() }
}

function runGit(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false
    let proc: ReturnType<typeof spawn>
    try {
      proc = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      resolve(undefined)
      return
    }

    const chunks: Buffer[] = []
    const settle = (value: string | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        proc.kill('SIGKILL')
      } catch {
        // proc may already be dead
      }
      resolve(value)
    }

    const timer = setTimeout(() => settle(undefined), timeoutMs)

    proc.stdout?.on('data', (c: Buffer) => chunks.push(c))
    proc.on('error', () => settle(undefined))
    proc.on('close', (code) => {
      if (code === 0) {
        settle(Buffer.concat(chunks).toString('utf8'))
      } else {
        settle(undefined)
      }
    })
  })
}

/**
 * `new Date()` rendered as ISO8601 with the local timezone offset
 * (e.g. `2026-05-30T12:00:00+08:00`). Stable across DST boundaries
 * because we read offset from the same Date instance.
 *
 * (Local copy of the helper in cli/commands/experiment.ts;
 * intentionally not refactored to share — this module lives in
 * core and that helper is private to the CLI package.)
 */
export function nowIsoLocal(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const absMin = Math.abs(offsetMin)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`
  )
}
