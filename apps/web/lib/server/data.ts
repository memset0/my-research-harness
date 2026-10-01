// Server-side data fetchers used by SSR prefetch.
//
// These mirror the JSON shape returned by /api/* routes so that prefetched
// data slots directly into the same TanStack Query keys used by the client
// (`fetchProjects` / `fetchExperiments` / etc.).
//
// As of `add-runtime-cache`, hypotheses + journal data come from the runtime
// in-memory cache, not from disk. RunIndex was already in-memory.

import 'server-only'

import {
  type CodeReviewSummary,
  deriveCompletion,
  isStaleRunning,
  parseCodeReview,
} from '@memon/core'
import type {
  FullCodeReview,
  FullExperiment,
  FullReport,
  ProjectSummary,
  WikiListItem,
  WikiPageDetail,
} from '../api'
import { discoverReports, findReport, readReport, type WebReportSummary } from './reports'
import { getRuntime } from './runtime'
import { wikiPageDto, wikiSummaryDto } from './wiki-route'

export async function getProjectsData(): Promise<{ projects: ProjectSummary[] }> {
  const rt = await getRuntime()
  return {
    projects: rt.config.projects.map((p) => ({
      mode: 'standalone' as const,
      host: null,
      project: p.name,
      name: p.name,
      root: p.root,
      exclude: p.exclude,
    })),
  }
}

/**
 * Load a Run detail for SSR hydration. Returns null when the Run does not
 * exist *or* belongs to a different project than the one in the URL, so a
 * viewer scoped to one project can never hydrate another project's README.
 */
export async function getExperimentData(
  project: string,
  id: string,
): Promise<FullExperiment | null> {
  const rt = await getRuntime()
  const exp = rt.index.get(id)
  if (!exp || exp.project !== project) return null
  // Touch the poller so the next backend GET refreshes promptly
  rt.pokeById(id)
  return {
    id: exp.id,
    project: exp.project,
    path: exp.path,
    mtime: exp.mtime,
    readmeMtime: exp.readmeMtime,
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
    return { path: '', events: [], parseErrors: [], parseWarnings: [] }
  }
  const entry = rt.journalCache.get(path)
  if (!entry || entry.value === null) {
    return { path, events: [], parseErrors: [], parseWarnings: [] }
  }
  const parsed = entry.value
  let events = [...parsed.events].reverse()
  const before = options.before
  if (before) events = events.filter((e) => e.timestamp < before)
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  if (Number.isFinite(limit)) events = events.slice(0, limit)
  return {
    path,
    events,
    parseErrors: parsed.parseErrors,
    parseWarnings: parsed.parseWarnings,
  }
}

// ---------- Reports ----------

export async function getReportsList(project: string): Promise<{ reports: WebReportSummary[] }> {
  const rt = await getRuntime()
  const dir = rt.reportsDir(project)
  if (!dir) return { reports: [] }
  const reports = (await discoverReports(dir)).map(({ rootPath: _rootPath, ...summary }) => summary)
  return { reports }
}

export async function getReport(project: string, id: string): Promise<FullReport | null> {
  const rt = await getRuntime()
  const dir = rt.reportsDir(project)
  if (!dir) return null
  const entry = await findReport(dir, id)
  if (!entry) return null
  const fresh = await readReport(entry)
  if (!fresh) return null
  return {
    id: entry.id,
    slug: entry.slug,
    path: entry.path,
    mtime: fresh.mtime,
    hash: fresh.hash,
    content: fresh.content,
    format: fresh.format,
  }
}

// ---------- Wiki ----------

export async function getWikiList(project: string): Promise<{ pages: WikiListItem[] }> {
  const rt = await getRuntime()
  const pages = rt.wikiCache.getWikiList(project).map((summary) => wikiSummaryDto(project, summary))
  return { pages }
}

export async function getWikiPage(project: string, id: string): Promise<WikiPageDetail | null> {
  const rt = await getRuntime()
  const page = await rt.wikiCache.getWikiPage(project, id)
  if (!page) return null
  return wikiPageDto(project, page.summary, page.content, page.hash)
}

export async function getCodeReviewsList(
  project: string,
): Promise<{ codeReviews: CodeReviewSummary[] }> {
  const rt = await getRuntime()
  return { codeReviews: rt.getCodeReviewsList(project) }
}

export async function getCodeReview(project: string, id: string): Promise<FullCodeReview | null> {
  const rt = await getRuntime()
  const path = rt.codeReviewPath(project, id)
  if (!path) return null
  const fresh = await rt.codeReviewsCache.getContent(path)
  if (!fresh) return null
  let parsed: ReturnType<typeof parseCodeReview>
  try {
    parsed = parseCodeReview(fresh.content)
  } catch {
    return null
  }
  const scope: 'project' | 'experiment' = id.startsWith('experiments/') ? 'experiment' : 'project'
  const expMatch = /^experiments\/(E\d{4}-[a-z0-9-]+)\/code-review\//.exec(id)
  return {
    id,
    scope,
    experiment: parsed.frontmatter.experiment ?? (expMatch ? expMatch[1]! : null),
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    mtime: fresh.mtime,
    hash: fresh.hash,
    completion: deriveCompletion(parsed.frontmatter),
  }
}
