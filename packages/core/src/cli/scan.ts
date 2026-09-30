// Bulk read of a project root: runs + hypotheses.
//
// One call replaces separate API hits (or separate CLI invocations) so skills
// can take a single snapshot and decide offline.
//
// Diagnostic Journal history is deliberately NOT part of this snapshot: it is
// neither read nor returned here. Callers that want legacy history call
// `readProjectJournal` explicitly.

import { join, resolve } from 'node:path'
import { discoverRuns, runArchivedFromRun } from '../discovery/discover.js'
import { matchesRunDeprecationFilter } from '../discovery/index.js'
import { readRunDir } from '../discovery/read.js'
import { isStaleRunning } from '../discovery/stale.js'
import { parseHypotheses } from '../hypotheses/parse.js'
import { projectFs as fs } from '../project-file-store.js'
import { formatIsoLocal } from '../time.js'
import type { ParsedHypotheses, Run } from '../types.js'

export interface IndexedRun extends Run {
  /**
   * v4: True iff the run is archived per `archive-frontmatter` semantics
   * (frontmatter field, with legacy sidecar fallback when the field is
   * missing). Always set on scan output.
   */
  archived: boolean
  /**
   * v6: True iff the run is deprecated (research-ineligible). Orthogonal to
   * `archived` and to `frontMatter.status`; always set on scan output.
   */
  deprecated: boolean
  /** Mirrors backend's stale-RUNNING flag. */
  stale: boolean
}

export interface ProjectSnapshot {
  projectRoot: string
  scannedAt: string
  experiments: IndexedRun[]
  hypotheses: { path: string | null } & ParsedHypotheses
}

export interface ScanOptions {
  includeArchived?: boolean
  /**
   * v6: include deprecated runs in the snapshot. Default false — deprecated
   * runs are outside normal research collections, aggregation, and counts.
   * Orthogonal to `includeArchived`.
   */
  includeDeprecated?: boolean
  /** v6: return ONLY deprecated runs; implies inclusion. */
  deprecatedOnly?: boolean
  /** Optional name to label the synthetic anonymous project. */
  projectName?: string
  /** Optional discovery globs inherited from a configured Project. */
  include?: string[]
  /** Optional discovery exclusions inherited from a configured Project. */
  exclude?: string[]
  /** Maximum concurrent Run directory reads during a cold scan. */
  readConcurrency?: number
}

export class ScanError extends Error {
  constructor(
    public code: 'NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'ScanError'
  }
}

export async function scanProjectRoot(
  projectRoot: string,
  options: ScanOptions = {},
): Promise<ProjectSnapshot> {
  const abs = resolve(projectRoot)
  const rootStat = await fs.stat(abs).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new ScanError('NOT_FOUND', `project root does not exist: ${abs}`)
    }
    throw error
  })
  if (!rootStat.isDirectory()) {
    throw new ScanError('NOT_FOUND', `project root is not a directory: ${abs}`)
  }

  const projectName = options.projectName ?? '(project-root)'
  const includeArchived = options.includeArchived ?? false

  const project = {
    name: projectName,
    root: abs,
    include: options.include ?? [],
    exclude: options.exclude ?? [],
  }

  // v4: discoverRuns returns ALL paths; archive filtering happens
  // post-parse using the README's frontmatter (with sidecar fallback for
  // the migration window).
  const dirs = await discoverRuns(project)
  const readConcurrency = options.readConcurrency ?? 16
  if (!Number.isSafeInteger(readConcurrency) || readConcurrency <= 0) {
    throw new Error('readConcurrency must be a positive safe integer')
  }
  const discovered = new Array<IndexedRun | null>(dirs.length).fill(null)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(readConcurrency, dirs.length) }, async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= dirs.length) return
        const exp = await readRunDir(dirs[index]!, projectName)
        const archived = await runArchivedFromRun(exp)
        if (!includeArchived && archived) continue
        // v6: deprecation is orthogonal to archival and to status — a
        // deprecated RUNNING or FAILED run is filtered the same way.
        const deprecated = exp.frontMatter.deprecated
        if (!matchesRunDeprecationFilter(deprecated, options)) continue
        discovered[index] = {
          ...exp,
          archived,
          deprecated,
          stale: isStaleRunning(exp),
        }
      }
    }),
  )
  const experiments = discovered.filter((run): run is IndexedRun => run !== null)

  // Sort by createdAt desc (matches `memon list` convention)
  experiments.sort((a, b) =>
    String(b.frontMatter.createdAt).localeCompare(String(a.frontMatter.createdAt)),
  )

  const hypothesesPath = join(abs, 'docs', 'hypotheses.md')
  const hypotheses = await tryParseHypotheses(hypothesesPath)

  return {
    projectRoot: abs,
    scannedAt: formatIsoLocal(new Date()),
    experiments,
    hypotheses: { path: hypotheses ? hypothesesPath : null, ...emptyOr(hypotheses, EMPTY_HYP) },
  }
}

const EMPTY_HYP: ParsedHypotheses = {
  legendBlock: null,
  summaryTableBlock: null,
  entries: [],
  parseErrors: [],
  parseWarnings: [],
}

function emptyOr<T>(value: T | null, fallback: T): T {
  return value ?? fallback
}

async function tryParseHypotheses(path: string): Promise<ParsedHypotheses | null> {
  try {
    const content = await fs.readFile(path, 'utf8')
    return parseHypotheses(content)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
