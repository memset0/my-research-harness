// Git command execution seam.
//
// The git readers in this directory parse output; they do not care where the
// command ran. A configured execution provider (for example an SSH target for
// a project whose files are only mounted locally) supplies its own runner so
// git never executes against a mounted working copy.
//
// Omitting a runner keeps today's behaviour exactly: `execFile` with the same
// cwd, timeout, maxBuffer and `windowsHide` options.
//
// `cachedGitCommand` wraps any runner in the process-wide read cache that
// every git-reading capability shares:
//
//   - owner:        this module; one cache per process, keyed on `globalThis`
//                   so a bundled duplicate of core still shares it.
//   - key:          namespace (execution target) + resolved cwd + binary +
//                   argv + encoding + execution limits. Never a domain projection.
//   - freshness:    30s for working-copy reads, 30min for a read addressed by
//                   a full object name; concurrent equal reads coalesce.
//   - invalidation: any command that is not a recognised read (every
//                   mutation) clears the cache before and after it runs, as
//                   does `invalidateGitOperations(cwd)` — registered below as
//                   a project-file change listener, so the Project file
//                   store never imports this module.
//   - failure:      never saved. A failed read is shared only with callers
//                   already joined to it, and the next caller retries.
//   - lifetime:     bounded to 256 entries / 32 MiB, oldest evicted first.

import { execFile } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { getProjectFileContext, onProjectFilesChanged } from '../project-file-context.js'

export interface GitCommandOptions {
  cwd: string
  timeoutMs: number
  maxBuffer: number
  /**
   * `'buffer'` is required by blob reads (`git show`) which must preserve
   * bytes for binary detection. Defaults to `'utf8'`.
   */
  encoding?: 'utf8' | 'buffer'
  /** Explicit refresh skips a saved answer but joins an equivalent in-flight read. */
  cache?: 'use' | 'refresh' | 'bypass'
}

export interface GitCommandResult {
  stdout: string | Buffer
  stderr: string
  /** Process exit code; use -1 together with `spawnFailed` when no process ran. */
  code: number
  /** The command exceeded `timeoutMs` and was killed. */
  timedOut?: boolean
  /** The git binary could not be started (missing binary, unreachable target). */
  spawnFailed?: boolean
  /** Transport/spawn diagnostic used when stderr is empty. */
  message?: string
}

export type GitCommandRunner = (
  bin: string,
  args: readonly string[],
  opts: GitCommandOptions,
) => Promise<GitCommandResult>

export const execFileGitCommand: GitCommandRunner = (bin, args, opts) =>
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

/** Classification inputs the readers already branch on. */
export interface GitExecFailure {
  err: { code?: string | number; killed?: boolean; message: string }
  stderr: string
}

export function isGitCommandFailure(result: GitCommandResult): boolean {
  return result.spawnFailed === true || result.timedOut === true || result.code !== 0
}

/**
 * Translate a runner result into the shape the readers' classifiers consume:
 * a missing binary or unreachable target becomes ENOENT (`git-not-found`), a
 * timeout becomes `killed` (`timeout`), everything else keeps stderr for the
 * existing `not-a-repo` / `error` distinction.
 */
export function toGitExecFailure(result: GitCommandResult): GitExecFailure {
  const message =
    result.message !== undefined && result.message.length > 0
      ? result.message
      : result.stderr.trim() || `git exited with code ${result.code}`
  return {
    err: {
      code: result.spawnFailed === true ? 'ENOENT' : result.code,
      killed: result.timedOut === true,
      message,
    },
    stderr: result.stderr,
  }
}

export function gitCommandStdoutText(result: GitCommandResult): string {
  return typeof result.stdout === 'string' ? result.stdout : result.stdout.toString('utf8')
}

export function gitCommandStdoutBytes(result: GitCommandResult): Buffer {
  return typeof result.stdout === 'string' ? Buffer.from(result.stdout, 'utf8') : result.stdout
}

interface GitCacheEntry {
  /** Resolved cwd of the read, so a mutation can invalidate by subtree. */
  cwd: string
  expiresAt: number
  bytes: number
  /** A mutation (or eviction) hit this entry: its result must not be saved. */
  invalidated: boolean
  /** The saved answer. A private copy; callers never receive this object. */
  value?: GitCommandResult
  /** The read in flight. Concurrent callers join it instead of respawning. */
  pending?: Promise<GitCommandResult>
}

interface GitCacheState {
  entries: Map<string, GitCacheEntry>
  wrappers: WeakSet<GitCommandRunner>
  runnerIds: WeakMap<GitCommandRunner, number>
  nextRunnerId: number
  bytes: number
}

const GIT_CACHE = Symbol.for('memon.git-operation-cache.v1')
/**
 * Working-copy observations need to survive a composed remote read: a short
 * browser staleTime can expire the first command before the last one settles.
 * Reuse observations for 30 seconds, independently of browser query policy.
 * Explicit manual requests refresh them; writes invalidate immediately.
 */
const GIT_MUTABLE_TTL_MS = 30_000
/** Content-addressed reads (`show`/`cat-file` of a full SHA) cannot change. */
const GIT_OBJECT_TTL_MS = 30 * 60_000
const GIT_CACHE_MAX_ENTRIES = 256
const GIT_CACHE_MAX_BYTES = 32 * 1024 * 1024

function gitCache(): GitCacheState {
  const carrier = globalThis as typeof globalThis & { [GIT_CACHE]?: GitCacheState }
  carrier[GIT_CACHE] ??= {
    entries: new Map(),
    wrappers: new WeakSet(),
    runnerIds: new WeakMap(),
    nextRunnerId: 0,
    bytes: 0,
  }
  return carrier[GIT_CACHE]
}

/**
 * Read commands whose output describes the working copy or a named ref, so a
 * saved answer is only valid for `GIT_MUTABLE_TTL_MS`. Anything absent here
 * is treated as a mutation: uncached, and it clears the cache around itself.
 */
const GIT_READ_COMMANDS: Record<string, true> = {
  'rev-parse': true,
  status: true,
  log: true,
  show: true,
  blame: true,
  'ls-files': true,
  'ls-tree': true,
  'cat-file': true,
  'for-each-ref': true,
  diff: true,
  'diff-tree': true,
  'rev-list': true,
  'merge-base': true,
  'check-ref-format': true,
}
/** Reads that address git objects directly, and are immutable at a full SHA. */
const GIT_OBJECT_COMMANDS: Record<string, true> = {
  show: true,
  'cat-file': true,
  'diff-tree': true,
  blame: true,
}
/** `git config` forms that only report configuration. */
const GIT_CONFIG_READ_FLAGS: Record<string, true> = {
  '--get': true,
  '--get-all': true,
  '--get-regexp': true,
  '--list': true,
  '-l': true,
}
const FULL_OBJECT_NAME_REGEX = /^(?:[a-f0-9]{40}|[a-f0-9]{64})(?::.*)?$/

/** Only known read forms may be cached. Unknown commands are treated as mutations. */
function gitReadLifetime(args: readonly string[]): number | null {
  let index = 0
  while (index < args.length) {
    if (args[index] === '-c') index += 2
    else if (args[index] === '--no-optional-locks' || args[index] === '--literal-pathspecs') index++
    else break
  }
  const command = args[index]
  if (command === undefined) return null
  const tail = args.slice(index + 1)
  // `--output=<file>` turns a read into a write.
  if (tail.some((arg) => arg === '--output' || arg.startsWith('--output='))) return null
  if (command === 'config') {
    return tail.some((arg) => GIT_CONFIG_READ_FLAGS[arg] === true) ? GIT_MUTABLE_TTL_MS : null
  }
  if (command === 'symbolic-ref') {
    // One operand reads a ref; two write it, `--delete` removes it.
    return tail.filter((arg) => !arg.startsWith('-')).length === 1 &&
      !tail.includes('--delete') &&
      !tail.includes('-d')
      ? GIT_MUTABLE_TTL_MS
      : null
  }
  if (GIT_READ_COMMANDS[command] !== true) return null
  if (GIT_OBJECT_COMMANDS[command] === true) {
    const separator = tail.indexOf('--')
    const revisions = (separator < 0 ? tail : tail.slice(0, separator)).filter(
      (arg) => !arg.startsWith('-'),
    )
    if (revisions.length > 0 && revisions.every((arg) => FULL_OBJECT_NAME_REGEX.test(arg))) {
      return GIT_OBJECT_TTL_MS
    }
  }
  return GIT_MUTABLE_TTL_MS
}

function discardGitEntry(state: GitCacheState, key: string, entry: GitCacheEntry): void {
  entry.invalidated = true
  if (state.entries.get(key) !== entry) return
  state.entries.delete(key)
  state.bytes -= entry.bytes
}

/**
 * Trim to the entry and byte caps, oldest first (a hit re-inserts, so Map
 * order is recency). A read still in flight is kept: its joiners share that
 * promise. A *finished* read is evictable even while `pending` still holds
 * its settled handle, otherwise a burst of concurrent reads would find
 * nothing to evict and grow the cache past both caps.
 */
function evictGitEntries(state: GitCacheState, keep: GitCacheEntry): void {
  for (const [key, entry] of state.entries) {
    if (state.entries.size <= GIT_CACHE_MAX_ENTRIES && state.bytes <= GIT_CACHE_MAX_BYTES) return
    if (entry === keep) continue
    if (entry.pending !== undefined && entry.value === undefined) continue
    discardGitEntry(state, key, entry)
  }
}

/** File or Git mutations invalidate related working-copy observations in every transport. */
export function invalidateGitOperations(cwd?: string): void {
  const state = gitCache()
  const root = cwd === undefined ? undefined : resolve(cwd)
  for (const [key, entry] of state.entries) {
    if (
      root === undefined ||
      entry.cwd === root ||
      entry.cwd.startsWith(root + sep) ||
      root.startsWith(entry.cwd + sep)
    ) {
      discardGitEntry(state, key, entry)
    }
  }
}

// Project file changes invalidate related working-copy observations. One
// registration per process: a duplicated bundle shares the cache and the
// listener set through `globalThis`.
const GIT_INVALIDATION_LISTENER = Symbol.for('memon.git-operation-cache.listener.v1')
{
  const carrier = globalThis as typeof globalThis & { [GIT_INVALIDATION_LISTENER]?: true }
  if (carrier[GIT_INVALIDATION_LISTENER] !== true) {
    carrier[GIT_INVALIDATION_LISTENER] = true
    onProjectFilesChanged((root) => invalidateGitOperations(root))
  }
}

function copyGitResult(result: GitCommandResult): GitCommandResult {
  return {
    ...result,
    stdout: Buffer.isBuffer(result.stdout) ? Buffer.from(result.stdout) : result.stdout,
  }
}

/**
 * The namespace of a runner that was wrapped without one. `execFileGitCommand`
 * is the process' own transport; any other runner is isolated by identity,
 * which only coalesces while that same function instance is reused — a runner
 * built per request (a configured SSH target, say) MUST pass an explicit
 * namespace or it caches nothing across requests.
 */
function runnerScope(state: GitCacheState, runner: GitCommandRunner): string {
  if (runner === execFileGitCommand) return 'local'
  let id = state.runnerIds.get(runner)
  if (id === undefined) {
    id = ++state.nextRunnerId
    state.runnerIds.set(runner, id)
  }
  return `runner:${id}`
}

/**
 * Run one read and save it. The entry is already in the map with its
 * `pending` promise, so this never races a second spawn of the same read.
 */
async function fillGitEntry(
  state: GitCacheState,
  key: string,
  entry: GitCacheEntry,
  ttl: number,
  run: () => Promise<GitCommandResult>,
): Promise<GitCommandResult> {
  try {
    const result = await run()
    // A failure is never saved: `git-not-found`, a timeout or an unreachable
    // SSH target must be retried by the next caller, not inherited by it.
    // Neither is a read that a mutation overlapped.
    if (entry.invalidated || isGitCommandFailure(result)) {
      discardGitEntry(state, key, entry)
      return result
    }
    const bytes = Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)
    if (bytes > GIT_CACHE_MAX_BYTES) {
      discardGitEntry(state, key, entry)
      return result
    }
    entry.value = copyGitResult(result)
    entry.expiresAt = performance.now() + ttl
    entry.bytes = bytes
    state.bytes += bytes
    evictGitEntries(state, entry)
    return result
  } catch (error) {
    discardGitEntry(state, key, entry)
    throw error
  } finally {
    entry.pending = undefined
  }
}

/**
 * Cache atomic Git command results, never whole domain projections.
 * Configured transports provide a stable namespace; arbitrary runners are
 * isolated by identity. Failures are shared only while in flight, never
 * saved, and anything that is not a recognised read is treated as a mutation:
 * it runs uncached and clears the observations around it.
 *
 * Wrapping is idempotent — an already wrapped runner is returned as it is —
 * so every reader may wrap defensively without stacking caches.
 */
export function cachedGitCommand(
  runner: GitCommandRunner = execFileGitCommand,
  namespace?: string,
): GitCommandRunner {
  const state = gitCache()
  if (state.wrappers.has(runner)) return runner
  const scope = namespace ?? runnerScope(state, runner)
  const wrapped: GitCommandRunner = async (bin, args, options) => {
    const mode = options.cache ?? (getProjectFileContext()?.reason === 'manual' ? 'refresh' : 'use')
    const ttl = gitReadLifetime(args)
    if (ttl === null) {
      // A mutation (or a command this module cannot classify as a read).
      // Invalidating first stops a read that is already in flight from saving
      // pre-mutation output; invalidating again afterwards drops anything that
      // observed the middle of it.
      invalidateGitOperations()
      try {
        return await runner(bin, args, options)
      } finally {
        invalidateGitOperations()
      }
    }
    const cwd = resolve(options.cwd)
    // A smaller buffer limit or deadline must not inherit a more permissive
    // in-flight invocation. Equivalent callers still share the same command.
    const key = JSON.stringify([
      scope,
      cwd,
      bin,
      args,
      options.encoding ?? 'utf8',
      options.timeoutMs,
      options.maxBuffer,
    ])
    if (mode === 'bypass') {
      // The caller distrusts the cache for a reason; leaving a saved answer
      // next to the fresh one it is about to read would serve that stale
      // answer to the next caller.
      const saved = state.entries.get(key)
      if (saved) discardGitEntry(state, key, saved)
      return await runner(bin, args, options)
    }
    const saved = state.entries.get(key)
    if (saved) {
      // An equivalent read is already running: join it, refresh included —
      // a read that started this instant is as fresh as one started next.
      if (saved.pending) return copyGitResult(await saved.pending)
      if (saved.value !== undefined && mode !== 'refresh' && performance.now() < saved.expiresAt) {
        state.entries.delete(key)
        state.entries.set(key, saved)
        return copyGitResult(saved.value)
      }
      discardGitEntry(state, key, saved)
    }
    const entry: GitCacheEntry = { cwd, expiresAt: 0, bytes: 0, invalidated: false }
    state.entries.set(key, entry)
    entry.pending = fillGitEntry(state, key, entry, ttl, () => runner(bin, args, options))
    // The initiating caller owns the runner's own result object; the entry
    // keeps a private copy, and joiners get copies of theirs.
    return await entry.pending
  }
  state.wrappers.add(wrapped)
  return wrapped
}
