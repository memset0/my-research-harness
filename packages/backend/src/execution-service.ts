// Explicit execution providers for command-shaped Backend capabilities
// (Git and Slurm).
//
// Centralized file access means a Project root may be an arbitrary mount of a
// remote filesystem. Reading such a root is fine — that is what the Project
// file store is for — but running commands against a mounted cwd is not: the
// command would execute on the wrong machine, against a filesystem view it
// command-shaped capability therefore resolves an explicit execution target
// first:
//
//   - `{ kind: 'local' }`  -> today's behaviour, byte for byte.
//   - `{ kind: 'ssh', … }` -> the same argv, run on the configured target with
//                             project paths translated into `remoteRoot`.
//   - no `execution` at all -> refusal (`EXECUTION_UNAVAILABLE`), never a
//                             silent local run against a mount.
//
// Commands are always argv arrays. Nothing here builds a remote shell string
// from caller input: the ssh provider quotes each argument itself, so a path or
// ref containing spaces or metacharacters cannot become extra remote words.

import { execFile } from 'node:child_process'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { GitCommandRunner, ProjectConfig, ProjectExecutionConfig } from '@memon/core'
import { cachedGitCommand } from '@memon/core'
import { isContained } from './containment.js'

export type BackendExecutionErrorCode =
  | 'EXECUTION_UNAVAILABLE'
  | 'EXECUTION_INVALID'
  | 'EXECUTION_OUTSIDE_PROJECT'

/**
 * A capability was requested for a Project with no usable execution target.
 * Routes map this to `501` with `{ error: { code } }`; the central dispatcher
 * also gates operational routes so a read-only mounted Project normally never
 * reaches a command path at all.
 */
export class BackendExecutionError extends Error {
  constructor(
    public readonly code: BackendExecutionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BackendExecutionError'
  }
}

export interface ExecutionCommandOptions {
  /** Absolute path in the *local* namespace; translated for remote targets. */
  cwd?: string
  timeoutMs?: number
  maxBuffer?: number
}

export interface ExecutionCommandResult {
  stdout: string
  stderr: string
  code: number
  /** The command was killed because it exceeded `timeoutMs`. */
  timedOut: boolean
  /** The executable could not be started at all (ENOENT and friends). */
  spawnFailed: boolean
}

/** Same outcome, with stdout preserved as bytes for binary-safe reads. */
export interface ExecutionBytesResult extends Omit<ExecutionCommandResult, 'stdout'> {
  stdout: Buffer
}

/**
 * Runs one argv on a Project's execution target and translates Project paths
 * into that target's namespace.
 */
export interface BackendExecutionProvider {
  readonly target: ProjectExecutionConfig
  /** Capture-oriented execution used by the git/Slurm readers. */
  run(
    bin: string,
    args: readonly string[],
    options?: ExecutionCommandOptions,
  ): Promise<ExecutionCommandResult>
  /**
   * Byte-preserving execution. Blob reads (`git show`) must not pass through a
   * UTF-8 decode, or binary detection and hashing would see repaired bytes.
   */
  runBytes(
    bin: string,
    args: readonly string[],
    options?: ExecutionCommandOptions,
  ): Promise<ExecutionBytesResult>
  /** Absolute local path -> the equivalent absolute path on the target. */
  resolvePath(absoluteLocalPath: string): string
}

export type BackendExecutionResolver = (project: ProjectConfig) => BackendExecutionProvider

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BUFFER = 1_048_576
/** `ssh` options every remote invocation pins: no prompts, no key drift. */
const SSH_BASE_OPTIONS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  'ConnectTimeout=10',
]
const SAFE_SSH_TARGET = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$/

/**
 * The Project's declared execution configuration, read structurally so this
 * module keeps working while the loader is the one that fills defaults.
 */
export function projectExecutionConfig(project: ProjectConfig): ProjectExecutionConfig | undefined {
  if (!('execution' in project)) return undefined
  const value: unknown = project.execution
  if (!value || typeof value !== 'object') return undefined
  const kind = 'kind' in value ? value.kind : undefined
  if (kind === 'local') return { kind: 'local' }
  if (kind !== 'ssh') return undefined
  const target = 'target' in value ? value.target : undefined
  if (typeof target !== 'string' || !SAFE_SSH_TARGET.test(target)) {
    throw new BackendExecutionError(
      'EXECUTION_INVALID',
      'Project execution target is not a valid SSH target',
    )
  }
  const remoteRoot = 'remoteRoot' in value ? value.remoteRoot : undefined
  if (typeof remoteRoot !== 'string' || !isAbsolute(remoteRoot)) {
    throw new BackendExecutionError(
      'EXECUTION_INVALID',
      'Project execution remoteRoot must be an absolute path',
    )
  }
  const rawPort = 'port' in value ? value.port : undefined
  const port = typeof rawPort === 'number' ? rawPort : undefined
  if (port !== undefined && (!Number.isSafeInteger(port) || port < 1 || port > 65_535)) {
    throw new BackendExecutionError('EXECUTION_INVALID', 'Project execution port is invalid')
  }
  const identityFile = 'identityFile' in value ? value.identityFile : undefined
  const knownHostsFile = 'knownHostsFile' in value ? value.knownHostsFile : undefined
  return {
    kind: 'ssh',
    target,
    remoteRoot,
    ...(port === undefined ? {} : { port }),
    ...(typeof identityFile === 'string' ? { identityFile } : {}),
    ...(typeof knownHostsFile === 'string' ? { knownHostsFile } : {}),
  }
}

/**
 * Execution provider for one Project. Absent configuration is an explicit
 * refusal: a mounted Project must not have its commands executed centrally.
 */
export function resolveProjectExecution(project: ProjectConfig): BackendExecutionProvider {
  const config = projectExecutionConfig(project)
  if (!config) {
    throw new BackendExecutionError(
      'EXECUTION_UNAVAILABLE',
      'Project has no execution target; commands are unavailable for this Project',
    )
  }
  return config.kind === 'local'
    ? createLocalExecutionProvider()
    : createSshExecutionProvider(project, config)
}

/**
 * The core git seam for one execution target: `undefined` for a local target,
 * so core keeps its own `execFile` path byte for byte (and shares the local
 * read cache with every other local reader), and otherwise a runner that
 * forwards every argv to the target with Project paths translated.
 *
 * Every git reader in core takes this same runner — history, status, blame,
 * blob reads, and the wiki review store — so a Project's `execution`
 * configuration decides where git runs no matter which capability reads it.
 *
 * The runner is wrapped in the shared git read cache under a namespace built
 * from the target's own coordinates. A provider is resolved per request, so
 * the runner closure is a new function every time: identity cannot be the
 * namespace, or nothing would ever coalesce across requests. Keying on the
 * target instead makes repeated reads of one host share a single SSH round
 * trip while keeping two hosts from ever reading each other's answers.
 */
export function gitCommandRunnerFor(
  execution: BackendExecutionProvider,
): GitCommandRunner | undefined {
  if (execution.target.kind === 'local') return undefined
  const target = execution.target
  const runner: GitCommandRunner = async (bin, args, options) => {
    const request = {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      maxBuffer: options.maxBuffer,
    }
    // Blob reads need the original bytes; everything else is text output.
    return options.encoding === 'buffer'
      ? execution.runBytes(bin, args, request)
      : execution.run(bin, args, request)
  }
  return cachedGitCommand(
    runner,
    // Two targets differing in any of these reach a different repository, a
    // different filesystem, or a different identity.
    JSON.stringify([
      'ssh',
      target.target,
      target.port ?? null,
      target.remoteRoot,
      target.identityFile ?? null,
      target.knownHostsFile ?? null,
    ]),
  )
}

/** Local execution: the historical `execFile` behaviour, unchanged. */
export function createLocalExecutionProvider(): BackendExecutionProvider {
  return {
    target: { kind: 'local' },
    run: (bin, args, options) => runLocalText(bin, args, options),
    runBytes: (bin, args, options) => runLocalBytes(bin, args, options),
    resolvePath: (absoluteLocalPath) => absoluteLocalPath,
  }
}

/**
 * Remote execution over `ssh`. The remote side receives one shell word per
 * argv element because every element is single-quoted here; callers keep
 * passing ordinary argv arrays and never build command strings.
 */
export function createSshExecutionProvider(
  project: ProjectConfig,
  config: Extract<ProjectExecutionConfig, { kind: 'ssh' }>,
): BackendExecutionProvider {
  const localRoot = resolve(project.root)
  const remoteRoot = config.remoteRoot.replace(/\/+$/, '') || '/'

  const resolvePath = (absoluteLocalPath: string): string => {
    const absolute = resolve(absoluteLocalPath)
    if (absolute === localRoot) return remoteRoot
    if (!isContained(localRoot, absolute)) {
      throw new BackendExecutionError(
        'EXECUTION_OUTSIDE_PROJECT',
        'Command path escapes the Project root',
      )
    }
    const rel = relative(localRoot, absolute)
    if (rel === '') return remoteRoot
    return `${remoteRoot}/${rel.split(sep).join('/')}`
  }

  const sshArgv = (bin: string, args: readonly string[], cwd?: string): string[] => {
    const remoteCwd = cwd ? resolvePath(cwd) : null
    const remoteCommand = [
      ...(remoteCwd ? ['cd', shellQuote(remoteCwd), '&&'] : []),
      shellQuote(bin),
      ...args.map(shellQuote),
    ].join(' ')
    return [
      'ssh',
      ...SSH_BASE_OPTIONS,
      '-T',
      ...(config.knownHostsFile ? ['-o', `UserKnownHostsFile=${config.knownHostsFile}`] : []),
      ...(config.identityFile ? ['-i', config.identityFile] : []),
      ...(config.port === undefined ? [] : ['-p', String(config.port)]),
      config.target,
      '--',
      remoteCommand,
    ]
  }

  // The remote cwd is carried inside the remote command; the local `ssh` child
  // inherits this process' cwd and must never see the mounted path.
  const localArgv = (bin: string, args: readonly string[], cwd: string | undefined) => {
    const [executable, ...argv] = sshArgv(bin, args, cwd)
    return { executable: executable!, argv }
  }

  return {
    target: config,
    run: (bin, args, options) => {
      const { executable, argv } = localArgv(bin, args, options?.cwd)
      return runLocalText(executable, argv, {
        timeoutMs: options?.timeoutMs,
        maxBuffer: options?.maxBuffer,
      })
    },
    runBytes: (bin, args, options) => {
      const { executable, argv } = localArgv(bin, args, options?.cwd)
      return runLocalBytes(executable, argv, {
        timeoutMs: options?.timeoutMs,
        maxBuffer: options?.maxBuffer,
      })
    },
    resolvePath,
  }
}

/** Single-quote one argv element for a remote POSIX shell. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

async function runLocalText(
  bin: string,
  args: readonly string[],
  options: ExecutionCommandOptions | undefined,
): Promise<ExecutionCommandResult> {
  const result = await runLocalBytes(bin, args, options)
  return { ...result, stdout: result.stdout.toString('utf8') }
}

function runLocalBytes(
  bin: string,
  args: readonly string[],
  options: ExecutionCommandOptions | undefined,
): Promise<ExecutionBytesResult> {
  // Executor form: this package targets the ES2022 lib, which has no
  // `Promise.withResolvers`.
  return new Promise<ExecutionBytesResult>((settle) => {
    execFile(
      bin,
      [...args],
      {
        ...(options?.cwd ? { cwd: options.cwd } : {}),
        timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
        windowsHide: true,
        encoding: 'buffer',
      },
      (error, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ''), 'utf8')
        const err = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '')
        if (!error) {
          settle({ stdout: out, stderr: err, code: 0, timedOut: false, spawnFailed: false })
          return
        }
        // `execFile` reports a spawn failure through a string `code` (ENOENT
        // and friends) and a timeout kill through `killed`; a plain non-zero
        // exit carries a numeric code.
        const spawnFailed = typeof error.code === 'string'
        settle({
          stdout: out,
          stderr: err,
          code: typeof error.code === 'number' ? error.code : spawnFailed ? -1 : 1,
          timedOut: error.killed === true,
          spawnFailed,
        })
      },
    )
  })
}
