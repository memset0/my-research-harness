// Git file-list + blob readers used by the dashboard's diff dialog.
//
// `readGitStatusFiles` re-uses the porcelain v2 invocation from `status.ts`
// but parses the per-file lines into staged / unstaged / untracked buckets.
// `readGitFileContents` reads the bytes at a specific side of a diff (HEAD,
// index, or working tree) with a 1024 KB cap and binary detection.

import { execFile, type ExecFileException } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { resolve, sep } from 'node:path'

export const MAX_DIFF_BYTES = 1024 * 1024

export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflict'
  | 'typechange'

export interface GitFileEntry {
  path: string
  status: GitFileStatus
  origPath?: string
}

export type GitStatusFiles =
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
      staged: GitFileEntry[]
      unstaged: GitFileEntry[]
      untracked: GitFileEntry[]
    }

export type ReadGitFileContentsResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'too-large'; sizeBytes: number; maxBytes: number }
  | { ok: false; reason: 'binary' }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'error'; message: string }

export interface ReadGitStatusFilesOptions {
  timeoutMs?: number
  gitBin?: string
}

export interface ReadGitFileContentsOptions {
  maxBytes?: number
  timeoutMs?: number
  gitBin?: string
}

const DEFAULT_TIMEOUT_MS = 3000

// --- readGitStatusFiles ---------------------------------------------------

export async function readGitStatusFiles(
  cwd: string,
  opts: ReadGitStatusFilesOptions = {},
): Promise<GitStatusFiles> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bin = opts.gitBin ?? 'git'

  return new Promise<GitStatusFiles>((resolveP) => {
    execFile(
      bin,
      ['status', '--porcelain=v2', '--branch', '--ignore-submodules=all'],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          resolveP(classifyStatusExecError(err, String(stderr ?? '')))
          return
        }
        try {
          resolveP(parsePorcelainV2WithFiles(String(stdout ?? '')))
        } catch (parseErr) {
          resolveP({
            enabled: false,
            reason: 'error',
            message: truncate((parseErr as Error).message ?? String(parseErr), 200),
          })
        }
      },
    )
  })
}

function classifyStatusExecError(err: unknown, stderr: string): GitStatusFiles {
  const e = err as ExecFileException & { code?: string | number; killed?: boolean }
  if (e.code === 'ENOENT') return { enabled: false, reason: 'git-not-found' }
  if (e.killed) return { enabled: false, reason: 'timeout' }
  if (/not a git repository/i.test(stderr)) {
    return { enabled: false, reason: 'not-a-repo' }
  }
  return {
    enabled: false,
    reason: 'error',
    message: truncate(stderr.trim() || e.message || 'git failed', 200),
  }
}

// --- parser ---------------------------------------------------------------

export function parsePorcelainV2WithFiles(stdout: string): GitStatusFiles {
  let branch: string | null = null
  let detached = false
  let sha = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const staged: GitFileEntry[] = []
  const unstaged: GitFileEntry[] = []
  const untracked: GitFileEntry[] = []

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
    } else if (rawLine.startsWith('1 ')) {
      // `1 XY sub <mH> <mI> <mW> <hH> <hI> <path>` — 8 single-space-delimited
      // fields precede the path; the path may contain spaces.
      const xy = rawLine.slice(2, 4)
      const path = sliceAfterNthSpace(rawLine, 8)
      if (!path) continue
      if (xy[0] && xy[0] !== '.') {
        staged.push({ path, status: statusFromCode(xy[0]!) })
      }
      if (xy[1] && xy[1] !== '.') {
        unstaged.push({ path, status: statusFromCode(xy[1]!) })
      }
    } else if (rawLine.startsWith('2 ')) {
      // `2 XY sub <mH> <mI> <mW> <hH> <hI> <X><score> <path><sep><origPath>`
      // — 9 single-space-delimited fields precede the path-tab-origPath
      // pair. `<sep>` is a literal TAB unless `-z` is passed (we don't).
      const xy = rawLine.slice(2, 4)
      const rest = sliceAfterNthSpace(rawLine, 9)
      if (!rest) continue
      const tab = rest.indexOf('\t')
      const path = tab === -1 ? rest : rest.slice(0, tab)
      const origPath = tab === -1 ? undefined : rest.slice(tab + 1)
      if (xy[0] && xy[0] !== '.') {
        staged.push({ path, status: statusFromCode(xy[0]!), origPath })
      }
      if (xy[1] && xy[1] !== '.') {
        unstaged.push({ path, status: statusFromCode(xy[1]!), origPath })
      }
    } else if (rawLine.startsWith('u ')) {
      // `u XY sub <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>` — 10 fields
      // precede the path.
      const path = sliceAfterNthSpace(rawLine, 10)
      if (!path) continue
      unstaged.push({ path, status: 'conflict' })
    } else if (rawLine.startsWith('? ')) {
      const path = rawLine.slice(2)
      if (path) untracked.push({ path, status: 'untracked' })
    }
    // `! ...` (ignored) — skipped intentionally.
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
  }
}

function sliceAfterNthSpace(line: string, n: number): string {
  let idx = 0
  for (let i = 0; i < n; i += 1) {
    const next = line.indexOf(' ', idx)
    if (next === -1) return ''
    idx = next + 1
  }
  return line.slice(idx)
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

// --- readGitFileContents --------------------------------------------------

export async function readGitFileContents(
  cwd: string,
  ref: 'HEAD' | 'index' | 'working',
  filePath: string,
  opts: ReadGitFileContentsOptions = {},
): Promise<ReadGitFileContentsResult> {
  const maxBytes = opts.maxBytes ?? MAX_DIFF_BYTES
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bin = opts.gitBin ?? 'git'

  if (ref === 'working') {
    // Path-safety: the resolved absolute path must stay under `cwd`.
    const absCwd = resolve(cwd)
    const target = resolve(cwd, filePath)
    if (target !== absCwd && !target.startsWith(absCwd + sep)) {
      return { ok: false, reason: 'error', message: 'path escapes project root' }
    }
    try {
      const stat = await fs.stat(target)
      if (stat.size > maxBytes) {
        return { ok: false, reason: 'too-large', sizeBytes: stat.size, maxBytes }
      }
      const buf = await fs.readFile(target)
      return classifyBuffer(buf, maxBytes)
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return { ok: false, reason: 'not-found' }
      return { ok: false, reason: 'error', message: truncate(e.message ?? String(e), 200) }
    }
  }

  const arg = ref === 'index' ? `:${filePath}` : `HEAD:${filePath}`

  // Probe size first so over-cap blobs never hit `maxBuffer`.
  const sizeRes = await catFileSize(bin, arg, cwd, timeoutMs)
  if (!sizeRes.ok) {
    return sizeRes.reason === 'not-found'
      ? { ok: false, reason: 'not-found' }
      : { ok: false, reason: 'error', message: sizeRes.message }
  }
  if (sizeRes.size > maxBytes) {
    return { ok: false, reason: 'too-large', sizeBytes: sizeRes.size, maxBytes }
  }

  return new Promise<ReadGitFileContentsResult>((resolveP) => {
    execFile(
      bin,
      ['show', arg],
      {
        cwd,
        timeout: timeoutMs,
        encoding: 'buffer',
        maxBuffer: maxBytes + 8 * 1024,
        windowsHide: true,
      },
      (err, stdoutBuf, stderr) => {
        if (err) {
          const stderrStr = String(stderr ?? '')
          const e = err as ExecFileException & { code?: string | number; killed?: boolean }
          if (e.code === 'ENOENT') {
            return resolveP({
              ok: false,
              reason: 'error',
              message: 'git binary not found',
            })
          }
          if (e.killed) {
            return resolveP({ ok: false, reason: 'error', message: 'timeout' })
          }
          if (isNotFoundStderr(stderrStr)) {
            return resolveP({ ok: false, reason: 'not-found' })
          }
          return resolveP({
            ok: false,
            reason: 'error',
            message: truncate(stderrStr.trim() || e.message || 'git failed', 200),
          })
        }
        const buf = Buffer.isBuffer(stdoutBuf)
          ? stdoutBuf
          : Buffer.from(String(stdoutBuf), 'utf8')
        resolveP(classifyBuffer(buf, maxBytes))
      },
    )
  })
}

interface SizeResultOk {
  ok: true
  size: number
}
interface SizeResultFail {
  ok: false
  reason: 'not-found' | 'error'
  message: string
}
type SizeResult = SizeResultOk | SizeResultFail

function catFileSize(
  bin: string,
  arg: string,
  cwd: string,
  timeoutMs: number,
): Promise<SizeResult> {
  return new Promise<SizeResult>((resolveS) => {
    execFile(
      bin,
      ['cat-file', '-s', arg],
      { cwd, timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const stderrStr = String(stderr ?? '')
          if (isNotFoundStderr(stderrStr)) {
            return resolveS({ ok: false, reason: 'not-found', message: 'not-found' })
          }
          const e = err as ExecFileException & { killed?: boolean }
          return resolveS({
            ok: false,
            reason: 'error',
            message: truncate(stderrStr.trim() || e.message || 'git failed', 200),
          })
        }
        const n = parseInt(String(stdout).trim(), 10)
        if (!Number.isFinite(n)) {
          return resolveS({
            ok: false,
            reason: 'error',
            message: 'cat-file size unparseable',
          })
        }
        resolveS({ ok: true, size: n })
      },
    )
  })
}

function isNotFoundStderr(stderr: string): boolean {
  return (
    /does not exist in/i.test(stderr) ||
    /exists on disk/i.test(stderr) ||
    /did not match any/i.test(stderr) ||
    /not a valid object/i.test(stderr) ||
    /Not a valid object name/i.test(stderr)
  )
}

function classifyBuffer(buf: Buffer, maxBytes: number): ReadGitFileContentsResult {
  if (buf.byteLength > maxBytes) {
    return {
      ok: false,
      reason: 'too-large',
      sizeBytes: buf.byteLength,
      maxBytes,
    }
  }
  // Binary heuristic: any 0x00 in the first 8 KB.
  const headLen = Math.min(buf.byteLength, 8 * 1024)
  for (let i = 0; i < headLen; i += 1) {
    if (buf[i] === 0) {
      return { ok: false, reason: 'binary' }
    }
  }
  // UTF-8 validity: use a fatal TextDecoder to reject any byte sequence the
  // standard does not accept (overlong forms, lone continuation bytes, etc.).
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return { ok: true, content }
  } catch {
    return { ok: false, reason: 'binary' }
  }
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max - 1) + '…'
}
