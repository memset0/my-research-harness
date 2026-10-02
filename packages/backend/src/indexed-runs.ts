// Run summaries served from the Project summary index.
//
// One entry per Run directory, fingerprinted by its README (the directory
// itself when there is no README). Loading an entry verifies containment with
// real paths, parses the README once, and records the archive, deprecation
// and eligibility facts list and detail consumers need. A later fingerprint
// match proves the same inode is still reached, so a swapped symlink shows up
// as a fingerprint change and a full re-resolution.

import type { Stats } from 'node:fs'
import { join } from 'node:path'
import {
  projectFs as fs,
  type IndexedRun,
  isRunPath,
  isStaleRunning,
  type ProjectConfig,
  projectRunPath,
  type Run,
  readRunDir,
  runEligibilityError,
  runFromReadme,
} from '@memon/core'
import {
  type Observation,
  projectReadIndex,
  type ReadPolicy,
  statObservation,
} from './read-index.js'
import { resolveRunPath } from './run-path.js'

export interface RunSummary {
  /** The parsed Run without its README body; `stale` is computed per read. */
  run: Omit<IndexedRun, 'stale'>
  /** Set when eligibility metadata is unreadable or malformed. */
  eligibilityError: string | null
  /**
   * The README never declares `archived`, so archival falls back to the
   * legacy `.archived` sidecar; consumers that need it ask `archivedRun`.
   */
  sidecarFallback: boolean
  /** The Run path was verified with real paths since this entry was loaded. */
  contained: boolean
}

const TERMINAL: Record<string, true> = { FINISHED: true, FAILED: true, INTERRUPTED: true }

/** The reuse window for a Run summary under `policy` on a list read. */
export function runListWindow(policy: ReadPolicy): (summary: RunSummary | null) => number {
  return (summary) =>
    summary && TERMINAL[summary.run.frontMatter.status] === true
      ? policy.terminalRunMaxAgeMs
      : policy.listMaxAgeMs
}

/**
 * The summary of the Run directory `dir` (absolute, lexical, inside the
 * Project). `null` when the directory does not exist. With `contained`, the
 * Run path is also verified with real paths (once per loaded entry); an
 * escaping or malformed path then throws.
 */
export async function indexedRun(
  project: ProjectConfig,
  dir: string,
  maxAgeMs: number | ((summary: RunSummary | null) => number),
  options: { contained?: boolean } = {},
): Promise<RunSummary | null> {
  const summary = await projectReadIndex(project.root).observe<RunSummary, RunObservation>(
    `run:${dir}`,
    maxAgeMs,
    async (): Promise<Observation<RunObservation>> => {
      const readme = await statObservation(join(dir, 'README.md'))
      if (readme.fingerprint !== null && readme.observed?.isFile()) {
        return {
          fingerprint: `readme:${readme.fingerprint}`,
          observed: { readme: readme.observed },
        }
      }
      const directory = await statObservation(dir)
      if (directory.fingerprint === null) return { fingerprint: null }
      return { fingerprint: `dir:${directory.fingerprint}`, observed: { readme: null } }
    },
    async (observed) => loadRunSummary(project, dir, observed?.readme ?? null),
  )
  if (summary && options.contained && !summary.contained) {
    // Containment and shape with real paths (the root's is request-scoped).
    // A walked directory is never a followed link, so only declared paths
    // pay for this, and only once per loaded entry.
    await resolveRunPath(project.root, projectRunPath(project.root, dir))
    summary.contained = true
  }
  return summary
}

interface RunObservation {
  readme: Stats | null
}

async function loadRunSummary(
  project: ProjectConfig,
  dir: string,
  readme: Stats | null,
): Promise<RunSummary> {
  let run: Run
  let eligibilityError: string | null = null
  if (!readme) {
    run = await readRunDir(dir, project.name)
  } else {
    const [content, dirStat] = await Promise.all([
      fs.readFile(join(dir, 'README.md'), 'utf8'),
      fs.stat(dir),
    ])
    run = runFromReadme(dir, project.name, content, dirStat.mtimeMs, readme.mtimeMs)
    eligibilityError = runEligibilityError(content)
  }
  const sidecarFallback = !run.frontMatterKeys.includes('archived')
  return {
    run: {
      ...run,
      body: '',
      archived: sidecarFallback ? false : run.frontMatter.archived,
      deprecated: run.frontMatter.deprecated,
    },
    eligibilityError,
    sidecarFallback,
    contained: false,
  }
}

/**
 * A request-local copy of a cached summary: callers may annotate
 * `frontMatter.experiment` or push parse warnings without touching the
 * shared entry.
 */
export function requestRun(summary: RunSummary): IndexedRun {
  const run = summary.run
  const copy = {
    ...run,
    frontMatter: { ...run.frontMatter },
    parseErrors: [...run.parseErrors],
    parseWarnings: [...run.parseWarnings],
    stale: false,
  }
  copy.stale = isStaleRunning(copy)
  return copy
}

/**
 * Resolve a declared project-relative Run path through the index: the summary
 * when an existing contained Run directory is there, `null` when absent.
 * Malformed or escaping paths throw.
 */
export function indexedDeclaredRun(
  project: ProjectConfig,
  reference: string,
  maxAgeMs: number | ((summary: RunSummary | null) => number),
): Promise<RunSummary | null> {
  if (!isRunPath(reference)) return Promise.reject(new Error('Invalid project-relative Run path'))
  return indexedRun(project, join(project.root, ...reference.split('/')), maxAgeMs, {
    contained: true,
  })
}

/**
 * `requestRun` with archival resolved: the frontmatter flag when declared,
 * otherwise the legacy sidecar (observed through the index, with the same
 * migration warning core adds). A README that declares `archived` is not
 * probed for a stale sidecar.
 */
export async function archivedRun(
  project: ProjectConfig,
  summary: RunSummary,
  maxAgeMs: number,
): Promise<IndexedRun> {
  const run = requestRun(summary)
  if (!summary.sidecarFallback) return run
  const sidecar = join(run.path, '.archived')
  const present = await projectReadIndex(project.root).observe<boolean>(
    `sidecar:${sidecar}`,
    maxAgeMs,
    async () => {
      try {
        await fs.access(sidecar)
        return { fingerprint: 'present' }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ENOTDIR') return { fingerprint: null }
        throw error
      }
    },
    async () => true,
  )
  if (present) {
    run.archived = true
    run.parseWarnings.push({
      field: 'archived',
      message: `LEGACY_ARCHIVE_SIDECAR: ${run.path}/.archived sidecar present; frontmatter is the canonical source in v4 — re-run migration to clean up`,
      severity: 'warning',
    })
  }
  return run
}
