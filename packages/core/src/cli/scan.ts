// Bulk read of a project root: experiments + hypotheses + journal.
//
// One call replaces three separate API hits (or three CLI invocations) so
// skills can take a single snapshot and decide offline.

import { promises as fs } from 'node:fs'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isStaleRunning } from '../discovery/stale.js'
import { discoverExperiments, isArchived } from '../discovery/discover.js'
import { readExperimentDir } from '../discovery/read.js'
import { parseHypotheses } from '../hypotheses/parse.js'
import { parseJournal } from '../journal/parse.js'
import type { Experiment, ParsedHypotheses, ParsedJournal } from '../types.js'

export interface IndexedExperiment extends Experiment {
  /** True iff `<runDir>/.archived` exists. Always set on scan output. */
  archived: boolean
  /** Mirrors backend's stale-RUNNING flag. */
  stale: boolean
}

export interface ProjectSnapshot {
  projectRoot: string
  scannedAt: string
  experiments: IndexedExperiment[]
  hypotheses: { path: string | null } & ParsedHypotheses
  journal: { path: string | null } & ParsedJournal
}

export interface ScanOptions {
  includeArchived?: boolean
  /** Optional name to label the synthetic anonymous project. */
  projectName?: string
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
    include: [],
    exclude: [],
  }

  const dirs = await discoverExperiments(project, { includeArchived })
  const experiments: IndexedExperiment[] = []
  for (const d of dirs) {
    const exp = await readExperimentDir(d, projectName)
    experiments.push({
      ...exp,
      archived: isArchived(d),
      stale: isStaleRunning(exp),
    })
  }

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
