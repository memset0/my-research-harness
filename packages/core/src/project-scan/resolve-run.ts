// Targeted Run resolution for single-target and batch CLI commands.
//
// `scanProjectRoot` is the wrong tool for "find run X": it parses EVERY run
// README plus `docs/hypotheses.md` just to answer a base-name lookup, and
// command paths that resolve several runs re-ran the whole scan once per
// lookup. On a network filesystem that is the dominant cost of commands whose
// real work is one README read and one atomic write.
//
// This layer keeps the same discovery boundary (`discoverRuns` over the
// project's `logs/`, `outputs/`, `experiments/` entries — no other traversal
// exists) but stops there: the walk yields directory PATHS, and only the
// directories a caller actually names are read. Nothing is cached beyond the
// lifetime of the index instance; every command still sees a fresh
// filesystem.
//

import { existsSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { discoverRuns } from '../discovery/discover.js'
import { readRunDir } from '../discovery/read.js'
import {
  declaredRunOwner,
  projectRunPath,
  resolveDeclaredRunPath,
  resolveRunReference,
} from '../experiments/run-path.js'
import type { Run, RunDepth } from '../types.js'
import { ScanError } from './scan.js'

export interface RunTargetOptions {
  /** Label applied to resolved records' `project` field. */
  projectName?: string
  /** Optional discovery globs inherited from a configured Project. */
  include?: string[]
  /** Optional discovery exclusions inherited from a configured Project. */
  exclude?: string[]
  /**
   * Optional Run walk depth bound (`run_depth`). Only base-name lookups walk;
   * project-relative paths resolve directly and ignore it.
   */
  runDepth?: RunDepth
  /** Maximum concurrent Run directory reads in `runs()`. */
  readConcurrency?: number
}

const DEFAULT_READ_CONCURRENCY = 16

/**
 * One bounded discovery pass over a project root, plus on-demand reads of the
 * Run directories a caller names. Archived AND deprecated runs are always
 * resolvable: an explicitly named target is never hidden (every caller of
 * the scan-based predecessor passed `includeArchived: true`, and v6
 * deprecation only removes a run from collections, never from lookup).
 */
export class RunTargetIndex {
  /** Run dir base name -> matching absolute dirs, in discovery (sorted) order. */
  private readonly dirsById: ReadonlyMap<string, string[]>
  private readonly root: string
  private readonly projectName: string
  private readonly readConcurrency: number
  /** Per-instance memo so one command resolves a given id at most once. */
  private readonly reads = new Map<string, Promise<Run | null>>()
  private readonly dirs = new Map<string, Promise<string | null>>()

  private constructor(
    dirsById: ReadonlyMap<string, string[]>,
    root: string,
    projectName: string,
    readConcurrency: number,
  ) {
    this.dirsById = dirsById
    this.root = root
    this.projectName = projectName
    this.readConcurrency = readConcurrency
  }

  /**
   * Walk the project's three Run entry directories once. Throws
   * `ScanError('NOT_FOUND')` for a missing / non-directory root, matching the
   * `scanProjectRoot` contract CLI callers were written against.
   */
  static async open(projectRoot: string, options: RunTargetOptions = {}): Promise<RunTargetIndex> {
    const abs = resolve(projectRoot)
    if (!existsSync(abs)) {
      throw new ScanError('NOT_FOUND', `project root does not exist: ${abs}`)
    }
    if (!statSync(abs).isDirectory()) {
      throw new ScanError('NOT_FOUND', `project root is not a directory: ${abs}`)
    }
    const readConcurrency = options.readConcurrency ?? DEFAULT_READ_CONCURRENCY
    if (!Number.isSafeInteger(readConcurrency) || readConcurrency <= 0) {
      throw new Error('readConcurrency must be a positive safe integer')
    }
    const paths = await discoverRuns({
      name: options.projectName ?? '(project-root)',
      root: abs,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
      ...(options.runDepth === undefined ? {} : { runDepth: options.runDepth }),
    })
    const dirsById = new Map<string, string[]>()
    for (const path of paths) {
      const id = basename(path)
      dirsById.set(projectRunPath(abs, path), [path])
      const existing = dirsById.get(id)
      if (existing) existing.push(path)
      else dirsById.set(id, [path])
    }
    return new RunTargetIndex(
      dirsById,
      abs,
      options.projectName ?? '(project-root)',
      readConcurrency,
    )
  }

  /** True when the project has a Run directory with this base name. */
  has(id: string): boolean {
    return this.dirsById.has(id)
  }

  /**
   * Absolute directory path for a Run id, or null when unknown. Reads nothing
   * in the common (unique base name) case; when two roots hold the same base
   * name it reads ONLY those duplicates to apply the same
   * newest-`created_at`-wins rule the scan-ordered lookup used.
   */
  async dir(id: string): Promise<string | null> {
    const memo = this.dirs.get(id)
    if (memo) return memo
    const candidates = this.dirsById.get(id)
    let pending: Promise<string | null>
    if (!candidates) pending = this.undiscoveredPath(id)
    else if (candidates.length === 1) pending = Promise.resolve(candidates[0]!)
    else pending = this.read(id).then((run) => run?.path ?? null)
    this.dirs.set(id, pending)
    return pending
  }

  /**
   * Full Run record for an id, or null when unknown. Reads only the named
   * directory (plus same-name duplicates, when they exist).
   */
  async read(id: string): Promise<Run | null> {
    const memo = this.reads.get(id)
    if (memo) return memo
    const pending = this.readUncached(id)
    this.reads.set(id, pending)
    return pending
  }

  /**
   * Batch form: resolve many ids with bounded concurrency, skipping unknown
   * ones. Unrelated Runs are never read.
   */
  async runs(ids: Iterable<string>): Promise<Map<string, Run>> {
    const wanted = [...new Set(ids)]
    const resolved = new Map<string, Run>()
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(this.readConcurrency, wanted.length) }, async () => {
        while (true) {
          const index = cursor
          cursor += 1
          if (index >= wanted.length) return
          const id = wanted[index]!
          const run = await this.read(id)
          if (run) resolved.set(id, run)
        }
      }),
    )
    return resolved
  }

  private async readUncached(id: string): Promise<Run | null> {
    const candidates = this.dirsById.get(id)
    if (!candidates) {
      const path = await this.undiscoveredPath(id)
      return path === null ? null : readRunDir(path, this.projectName)
    }
    if (candidates.length === 1) return readRunDir(candidates[0]!, this.projectName)
    throw new Error(`Ambiguous Run ID; use a project-relative path: ${id}`)
  }

  /**
   * A project-relative Run path the walk did not reach (excluded or beyond
   * `runDepth`) still resolves directly: path targets never depend on the
   * walk. Base names and missing / unsafe paths resolve to null.
   */
  private async undiscoveredPath(id: string): Promise<string | null> {
    if (!id.includes('/')) return null
    try {
      return await resolveDeclaredRunPath(this.root, id)
    } catch {
      return null
    }
  }
}

/**
 * One-shot single-target resolution: discover, then read just that Run.
 * Commands that resolve more than one Run should hold a `RunTargetIndex`
 * instead so the discovery walk happens once.
 */
export async function resolveRunTarget(
  projectRoot: string,
  id: string,
  options: RunTargetOptions = {},
): Promise<Run | null> {
  const path = await resolveRunReference(
    {
      root: projectRoot,
      name: options.projectName ?? '(project-root)',
      include: options.include ?? [],
      exclude: options.exclude ?? [],
      ...(options.runDepth === undefined ? {} : { runDepth: options.runDepth }),
    },
    id,
  )
  if (!path) return null
  const run = await readRunDir(path, options.projectName ?? '(project-root)')
  run.frontMatter.experiment = await declaredRunOwner(projectRoot, path, options.projectName)
  return run
}
