// Bulk read of a project root: experiments + hypotheses + journal.
//
// One call replaces three separate API hits (or three CLI invocations) so
// skills can take a single snapshot and decide offline.

import { existsSync, promises as fs, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { discoverRuns, runArchivedFromRun } from '../discovery/discover.js'
import { readRunDir } from '../discovery/read.js'
import { isStaleRunning } from '../discovery/stale.js'
import { parseHypotheses } from '../hypotheses/parse.js'
import { parseJournal } from '../journal/parse.js'
import type { ParsedHypotheses, ParsedJournal, Run } from '../types.js'

export interface IndexedRun extends Run {
  /**
   * v4: True iff the run is archived per `archive-frontmatter` semantics
   * (frontmatter field, with legacy sidecar fallback when the field is
   * missing). Always set on scan output.
   */
  archived: boolean
  /** Mirrors backend's stale-RUNNING flag. */
  stale: boolean
}

export interface ProjectSnapshot {
  projectRoot: string
  scannedAt: string
  experiments: IndexedRun[]
  hypotheses: { path: string | null } & ParsedHypotheses
  journal: { path: string | null } & ParsedJournal
}

export interface ScanOptions {
  includeArchived?: boolean
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
  if (!existsSync(abs)) {
    throw new ScanError('NOT_FOUND', `project root does not exist: ${abs}`)
  }
  if (!statSync(abs).isDirectory()) {
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
        const archived = runArchivedFromRun(exp)
        if (!includeArchived && archived) continue
        discovered[index] = {
          ...exp,
          archived,
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

  const journalPath = join(abs, 'docs', 'journal.md')
  const journal = await tryParseJournal(journalPath)

  return {
    projectRoot: abs,
    scannedAt: new Date().toISOString(),
    experiments,
    hypotheses: { path: hypotheses ? hypothesesPath : null, ...emptyOr(hypotheses, EMPTY_HYP) },
    journal: { path: journal ? journalPath : null, ...emptyOr(journal, EMPTY_JOURNAL) },
  }
}

const EMPTY_HYP: ParsedHypotheses = {
  legendBlock: null,
  summaryTableBlock: null,
  entries: [],
  parseErrors: [],
  parseWarnings: [],
}

const EMPTY_JOURNAL: ParsedJournal = {
  lastDigestAt: null,
  events: [],
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

async function tryParseJournal(path: string): Promise<ParsedJournal | null> {
  try {
    const content = await fs.readFile(path, 'utf8')
    return parseJournal(content)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
