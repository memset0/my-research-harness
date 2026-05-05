// Server-side data fetchers used by SSR prefetch.
//
// These mirror the JSON shape returned by /api/* routes so that prefetched
// data slots directly into the same TanStack Query keys used by the client
// (`fetchProjects` / `fetchExperiments` / etc.).
//
// As of `add-runtime-cache`, hypotheses + journal data come from the runtime
// in-memory cache, not from disk. ExperimentIndex was already in-memory.

import 'server-only'

import { isStaleRunning, type DigestSummary, type ReportSummary } from '@memon/core'
import { getRuntime } from '../runtime'
import type {
  FullDigest,
  FullExperiment,
  FullReport,
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
    warnings: exp.warnings,
    warningsRaw: exp.warningsRaw,
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

// ---------- Reports + Digests ----------

export async function getReportsList(project: string): Promise<{ reports: ReportSummary[] }> {
  const rt = await getRuntime()
  const dir = rt.reportsDir(project)
  if (!dir) return { reports: [] }
  const reports = rt.reportsCache.getList(dir).slice().sort((a, b) => {
    if (a.id > b.id) return -1
    if (a.id < b.id) return 1
    return 0
  })
  return { reports }
}

export async function getReport(project: string, id: string): Promise<FullReport | null> {
  const rt = await getRuntime()
  const dir = rt.reportsDir(project)
  if (!dir) return null
  const entry = rt.reportsCache.getList(dir).find((r) => r.id === id)
  if (!entry) return null
  const fresh = await rt.reportsCache.getContent(entry.path)
  if (!fresh) return null
  return {
    id: entry.id,
    slug: entry.slug,
    path: entry.path,
    mtime: fresh.mtime,
    hash: fresh.hash,
    content: fresh.content,
  }
}

export async function getDigestsList(project: string): Promise<{ digests: DigestSummary[] }> {
  const rt = await getRuntime()
  const dir = rt.digestsDir(project)
  if (!dir) return { digests: [] }
  const digests = rt.digestsCache.getList(dir).slice().sort((a, b) => {
    if (a.date > b.date) return -1
    if (a.date < b.date) return 1
    if (a.id > b.id) return -1
    if (a.id < b.id) return 1
    return 0
  })
  return { digests }
}

export async function getDigest(project: string, id: string): Promise<FullDigest | null> {
  const rt = await getRuntime()
  const dir = rt.digestsDir(project)
  if (!dir) return null
  const entry = rt.digestsCache.getList(dir).find((d) => d.id === id)
  if (!entry) return null
  const fresh = await rt.digestsCache.getContent(entry.path)
  if (!fresh) return null
  return {
    id: entry.id,
    date: entry.date,
    path: entry.path,
    mtime: fresh.mtime,
    hash: fresh.hash,
    content: fresh.content,
  }
}
