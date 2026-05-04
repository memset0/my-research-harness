// Server-side data fetchers used by SSR prefetch.
//
// These mirror the JSON shape returned by /api/* routes so that prefetched
// data slots directly into the same TanStack Query keys used by the client
// (`fetchProjects` / `fetchExperiments` / etc.).
//
// As of `add-runtime-cache`, hypotheses + journal data come from the runtime
// in-memory cache, not from disk. ExperimentIndex was already in-memory.

import 'server-only'

import { isStaleRunning } from '@memon/core'
import { getRuntime } from '../runtime'
import type {
  FullExperiment,
  IndexedExperiment,
  ProjectSummary,
} from '../api'

export async function getProjectsData(): Promise<{ projects: ProjectSummary[] }> {
  const rt = await getRuntime()
  return {
    projects: rt.config.projects.map((p) => ({
      name: p.name,
      root: p.root,
      exclude: p.exclude,
    })),
  }
}

export async function getExperimentsData(
  project?: string,
): Promise<{ experiments: IndexedExperiment[] }> {
  const rt = await getRuntime()
  const experiments = rt.index.list({ project })
  return {
    experiments: experiments.map((e) => ({
      id: e.id,
      project: e.project,
      path: e.path,
      mtime: e.mtime,
      hasReadme: e.hasReadme,
      frontMatter: e.frontMatter,
      parseErrors: e.parseErrors,
      parseWarnings: e.parseWarnings,
      stale: isStaleRunning(e),
    })),
  }
}

export async function getExperimentData(id: string): Promise<FullExperiment | null> {
  const rt = await getRuntime()
  const exp = rt.index.get(id)
  if (!exp) return null
  // Touch the poller so the next backend GET refreshes promptly
  rt.pokeById(id)
  return {
    id: exp.id,
    project: exp.project,
    path: exp.path,
    mtime: exp.mtime,
    hasReadme: exp.hasReadme,
    frontMatter: exp.frontMatter,
    sections: exp.sections,
    body: exp.body,
    parseErrors: exp.parseErrors,
    parseWarnings: exp.parseWarnings,
    stale: isStaleRunning(exp),
    resources: null,
  }
}

const EMPTY_HYPS = {
  legendBlock: null,
  summaryTableBlock: null,
  entries: [],
  parseErrors: [],
  parseWarnings: [],
} as const

export async function getHypothesesData(project: string) {
  const rt = await getRuntime()
  const path = rt.hypothesesPath(project)
  if (!path) return { path: '', ...EMPTY_HYPS }
  const entry = rt.hypothesesCache.get(path)
  if (!entry || entry.value === null) return { path, ...EMPTY_HYPS }
  return { path, ...entry.value }
}

export async function getJournalData(
  project: string,
  options: { limit?: number; before?: string } = {},
) {
  const rt = await getRuntime()
  const path = rt.journalPath(project)
  if (!path) {
    return { path: '', lastDigestAt: null, events: [], parseErrors: [], parseWarnings: [] }
  }
  const entry = rt.journalCache.get(path)
  if (!entry || entry.value === null) {
    return { path, lastDigestAt: null, events: [], parseErrors: [], parseWarnings: [] }
  }
  const parsed = entry.value
  let events = [...parsed.events].reverse()
  const before = options.before
  if (before) events = events.filter((e) => e.timestamp < before)
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  if (Number.isFinite(limit)) events = events.slice(0, limit)
  return {
    path,
    lastDigestAt: parsed.lastDigestAt,
    events,
    parseErrors: parsed.parseErrors,
    parseWarnings: parsed.parseWarnings,
  }
}
