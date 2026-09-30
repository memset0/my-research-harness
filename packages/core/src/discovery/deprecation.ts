// v6: Run deprecation — a research-eligibility flag, orthogonal to both
// `status` and `archived`.
//
// Deprecating a Run says "do not count this evidence any more" (bad config,
// corrupted data, superseded setup). It is pure bookkeeping:
//   - it never signals or kills a process; a RUNNING run may be deprecated
//   - it never deletes or moves artifacts, logs, or the README
//   - it is NOT archival (a shelving/visibility concern) and NOT failure
//     (an execution outcome); all three are independent booleans/states
//
// The flag is a bare boolean: no reason, no successor, no second research
// ledger. Restoration is `undeprecateRun`, which removes the key again so a
// restored run is byte-identical to its pre-deprecation state.
//
// Writes are frontmatter-surgical (see readme/frontmatter-patch.ts) so a
// legacy rich README keeps its body verbatim and a minimal record is not
// promoted into the old narrative layout.

import { basename, dirname, join, resolve } from 'node:path'
import { projectRunPath, resolveRunReference } from '../experiments/run-path.js'
import { projectFs as fs } from '../project-file-store.js'
import { patchRunFrontMatter } from '../readme/frontmatter-patch.js'
import { parseReadme } from '../readme/parse.js'
import type { ParsedReadme, Run } from '../types.js'
import { yamlEngine } from '../yaml-engine.js'
import { discoverRuns } from './discover.js'

export interface DeprecationResult {
  runDir: string
  /** Deprecation state before the call. */
  prev: boolean
  /** Deprecation state after the call (equals the requested target). */
  next: boolean
  /** True when the run was already in the requested state: nothing written. */
  noop: boolean
  /** README mtime after the call — the next optimistic-locking token. */
  mtime: number
}

export interface SetRunDeprecatedOptions {
  /** ISO8601-with-offset timestamp written to `updated_at`. */
  now: string
  /** Run id for error messages; defaults to the frontmatter/dir id. */
  id?: string
  /**
   * Optimistic concurrency: when given, the README's current mtime in epoch
   * milliseconds must equal it, or `RunWriteConflictError` is thrown.
   */
  expectedMtime?: number
}

/** Lost-update guard for run README writes. */
export class RunWriteConflictError extends Error {
  readonly code = 'CONFLICT'
  constructor(
    readonly runId: string,
    readonly expectedMtime: number,
    readonly currentMtime: number,
  ) {
    super(
      `run ${runId} changed on disk (expected mtime ${expectedMtime}, found ${currentMtime}); re-read before writing`,
    )
    this.name = 'RunWriteConflictError'
  }
}

/** Is this run excluded from research by an explicit deprecation? */
export function isRunDeprecated(run: Pick<Run, 'frontMatter'> | ParsedReadme): boolean {
  return run.frontMatter.deprecated
}

/**
 * Set the run's deprecation flag to `target`. Idempotent: when the run is
 * already in the requested state nothing is written, `updated_at` is not
 * bumped, and `noop` is true. Never refuses on account of `status` —
 * RUNNING, FINISHED, and FAILED runs are all deprecatable.
 */
export async function setRunDeprecated(
  runDir: string,
  target: boolean,
  options: SetRunDeprecatedOptions,
): Promise<DeprecationResult> {
  const readmePath = join(runDir, 'README.md')
  const content = await fs.readFile(readmePath, 'utf8')
  const stat = await fs.stat(readmePath)
  const parsed = parseReadme(content)
  const runId = options.id ?? parsed.frontMatter.id
  if (options.expectedMtime !== undefined && options.expectedMtime !== stat.mtimeMs) {
    throw new RunWriteConflictError(runId, options.expectedMtime, stat.mtimeMs)
  }

  const prev = parsed.frontMatter.deprecated
  if (prev === target) {
    return { runDir, prev, next: target, noop: true, mtime: stat.mtimeMs }
  }

  // `deprecated: null` removes the key: absence is the canonical `false`, so
  // an undeprecated run carries no residue of having been deprecated.
  // Timestamps start with a digit, so YAML needs them quoted to stay
  // strings; a caller-quoted value is passed through untouched.
  const now = /^['"]/.test(options.now) ? options.now : `'${options.now.replace(/'/g, "''")}'`
  const next = patchRunFrontMatter(content, {
    deprecated: target ? true : null,
    updated_at: now,
  })
  await atomicWrite(readmePath, next)
  const after = await fs.stat(readmePath)
  return { runDir, prev, next: target, noop: false, mtime: after.mtimeMs }
}

/** Exclude a run from research collections; keeps every artifact in place. */
export async function deprecateRun(
  runDir: string,
  options: SetRunDeprecatedOptions,
): Promise<DeprecationResult> {
  return setRunDeprecated(runDir, true, options)
}

/** Restore a deprecated run to full research eligibility. */
export async function undeprecateRun(
  runDir: string,
  options: SetRunDeprecatedOptions,
): Promise<DeprecationResult> {
  return setRunDeprecated(runDir, false, options)
}

/**
 * Deprecated ids, optionally restricted to an Experiment's declared/cited Runs.
 * Reads go through the project file store; only YAML frontmatter is parsed.
 * No Run bodies, logs or artifacts are materialized into the projection.
 * Unreadable or malformed eligibility metadata is an error, never `valid`.
 */
export async function listDeprecatedRunIds(
  projectRoot: string,
  options: ListDeprecatedRunIdsOptions = {},
): Promise<string[]> {
  if (options.ids?.length === 0) return []
  const wanted = options.ids === undefined ? null : new Set(options.ids)
  const project = {
    name: options.projectName ?? '(project-root)',
    root: resolve(projectRoot),
    include: options.include ?? [],
    exclude: options.exclude ?? [],
  }
  const dirs = wanted
    ? (
        await Promise.all([...wanted].map((reference) => resolveRunReference(project, reference)))
      ).filter((path): path is string => path !== null)
    : await discoverRuns(project)
  const concurrency = options.readConcurrency ?? 16
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error('readConcurrency must be a positive safe integer')
  }
  const deprecated: string[] = []
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, dirs.length) }, async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= dirs.length) return
        const dir = dirs[index]!
        let content: string
        try {
          content = await fs.readFile(join(dir, 'README.md'), 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        if (readDeprecatedFlag(content)) {
          const path = projectRunPath(projectRoot, dir)
          if (!wanted || wanted.has(path)) deprecated.push(path)
          if (wanted?.has(basename(dir))) deprecated.push(basename(dir))
        }
      }
    }),
  )
  return [...new Set(deprecated)].sort()
}

export interface ListDeprecatedRunIdsOptions {
  /** Restrict metadata reads to these ids; an empty list performs no discovery. */
  ids?: readonly string[]
  /** Label for the synthetic anonymous project used during discovery. */
  projectName?: string
  /** Discovery globs inherited from a configured Project. */
  include?: string[]
  /** Discovery exclusions inherited from a configured Project. */
  exclude?: string[]
  /** Maximum concurrent README frontmatter reads. */
  readConcurrency?: number
}

// ---------- helpers ----------

/** Read only the flag from the leading YAML block, never parse the Run body. */
function readDeprecatedFlag(content: string): boolean {
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(content)
  if (!opening) return false
  const closing = /^(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/gm
  closing.lastIndex = opening[0].length
  const close = closing.exec(content)
  if (!close) throw new Error('Run eligibility frontmatter is not terminated')
  const data = yamlEngine.parse(content.slice(opening[0].length, close.index))
  if (data === null || data === undefined) return false
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Run eligibility frontmatter must be a YAML mapping')
  }
  const flag = (data as Record<string, unknown>).deprecated
  if (flag === undefined) return false
  if (typeof flag !== 'boolean') throw new Error('Run deprecated field must be boolean')
  return flag
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = join(dirname(path), `.${Date.now()}-${process.pid}.tmp`)
  try {
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, path)
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {})
  }
}
