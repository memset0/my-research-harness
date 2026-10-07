// Server-side data fetchers used by SSR prefetch.
//
// These mirror the JSON shape returned by /api/* routes so that prefetched
// data slots directly into the same TanStack Query keys used by the client
// (`fetchProjects` / `fetchExperiments` / etc.).
//
// SSR and JSON routes compose the same services over shared file primitives.

import 'server-only'

import { BackendProjectServiceError } from '@memon/backend'

import {
  BackendCodeReviewResponseSchema,
  BackendCodeReviewsResponseSchema,
  BackendHypothesesResponseSchema,
  BackendJournalResponseSchema,
  BackendReportResponseSchema,
  BackendReportsResponseSchema,
  BackendRunResponseSchema,
  BackendWikiDocumentSchema,
  BackendWikiPagesResponseSchema,
  type CodeReviewSummary,
} from '@memon/core'
import type {
  FullCodeReview,
  FullExperiment,
  FullReport,
  ProjectSummary,
  WikiListItem,
  WikiPageDetail,
} from '../api'
import type { Wire } from '../dto/wire'
import type { WebReportSummary } from './reports'
import { getRuntime } from './runtime'
import { standaloneCodeReview, standaloneReport, standaloneRun } from './standalone-dto'
import { standaloneServices } from './standalone-services'
import { wikiComponentProjection } from './wiki-route'

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
): Promise<Wire<FullExperiment> | null> {
  const rt = await getRuntime()
  try {
    const value = BackendRunResponseSchema.parse(
      await standaloneServices(rt.config).projects.getRun(project, id),
    )
    return standaloneRun(rt.config, value)
  } catch (error) {
    if (
      error instanceof BackendProjectServiceError &&
      ['RESOURCE_NOT_FOUND', 'PROJECT_NOT_FOUND'].includes(error.code)
    )
      return null
    throw error
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
  return {
    path,
    ...BackendHypothesesResponseSchema.parse(
      await standaloneServices(rt.config).projects.getHypotheses(project),
    ),
  }
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
  const parsed = BackendJournalResponseSchema.parse(
    await standaloneServices(rt.config).projects.getJournal(project),
  )
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
  const result = BackendReportsResponseSchema.parse(
    await standaloneServices(rt.config).documents.listReports(project),
  )
  return { reports: result.reports.map((report) => standaloneReport(rt.config, report)) }
}

export async function getReport(project: string, id: string): Promise<FullReport | null> {
  const rt = await getRuntime()
  const result = BackendReportResponseSchema.parse(
    await standaloneServices(rt.config).documents.getReport(project, id),
  )
  return standaloneReport(rt.config, result)
}

// ---------- Wiki ----------

export async function getWikiList(project: string): Promise<{ pages: WikiListItem[] }> {
  const rt = await getRuntime()
  const result = BackendWikiPagesResponseSchema.parse(
    await standaloneServices(rt.config).documents.listWiki(project),
  )
  return { pages: result.pages.map((page) => ({ ...page, path: page.resource })) }
}

export async function getWikiPage(project: string, id: string): Promise<WikiPageDetail | null> {
  const rt = await getRuntime()
  const page = BackendWikiDocumentSchema.parse(
    await standaloneServices(rt.config).documents.getWiki(project, id),
  )
  const projection = wikiComponentProjection(page.content)
  return {
    ...page,
    path: page.resource,
    components: projection.components,
    diagnostics: [...page.diagnostics, ...projection.diagnostics],
  }
}

export async function getCodeReviewsList(
  project: string,
): Promise<{ codeReviews: CodeReviewSummary[] }> {
  const rt = await getRuntime()
  const result = BackendCodeReviewsResponseSchema.parse(
    await standaloneServices(rt.config).documents.listCodeReviews(project),
  )
  return {
    codeReviews: result.codeReviews.map((review) => standaloneCodeReview(rt.config, review)),
  }
}

export async function getCodeReview(project: string, id: string): Promise<FullCodeReview | null> {
  const rt = await getRuntime()
  return BackendCodeReviewResponseSchema.parse(
    await standaloneServices(rt.config).documents.getCodeReview(project, id),
  )
}
