// Thin fetch wrappers for the /api/* routes. Used via TanStack Query.
// We `import type` for everything so the @memon/core JS module never enters
// the client bundle (it transitively pulls in fast-glob → fs).

import type {
  BackendResourceInventoryResponse,
  BackendWikiInventoryResponse,
  Hypothesis,
  JournalEvent,
  Run,
  WarningRecord,
} from '@memon/core'
import { type ProjectTarget, projectHost, projectName } from './project-target'

export type {
  CentralProjectSummary,
  HostsResponse,
  ProjectSummary,
  ProjectsResponse,
  StandaloneProjectSummary,
} from './dto/projects'

import type { HostsResponse, ProjectsResponse } from './dto/projects'

export type {
  FullExperiment,
  IndexedRun,
  PatchArchiveForbidden,
  PatchArchiveResponse,
  PatchStatusForbidden,
  PatchStatusResponse,
  RunFilesResponse,
  RunFileTreeNode,
  RunsResponse,
} from './dto/runs'

import type {
  FullExperiment,
  PatchArchiveForbidden,
  PatchArchiveResponse,
  PatchStatusForbidden,
  PatchStatusResponse,
  RunFilesResponse,
  RunsResponse,
} from './dto/runs'

export type {
  FetchedReadme,
  PathReadmeResponse,
  PutReadmeConflict,
  PutReadmeResponse,
} from './dto/documents'

import type {
  FetchedReadme,
  PathReadmeResponse,
  PutReadmeConflict,
  PutReadmeResponse,
} from './dto/documents'

export type {
  ExperimentBindInput,
  ExperimentBindResponse,
  ExperimentCreateResponse,
  ExperimentDeleteResponse,
  ExperimentDisplaySection,
  ExperimentDocDetail,
  ExperimentDocSummary,
  ExperimentDocsResponse,
  ExperimentListRow,
  ExperimentManagedDocumentPayload,
  ExperimentManagedDocumentsPayload,
  ExperimentResultsSnapshot,
  PatchExperimentStatusResponse,
  ResultsVariantEligibilityPayload,
} from './dto/experiments'

import type {
  ExperimentBindInput,
  ExperimentBindResponse,
  ExperimentCreateResponse,
  ExperimentDeleteResponse,
  ExperimentDocDetail,
  ExperimentDocsResponse,
  ExperimentResultsSnapshot,
  PatchExperimentStatusResponse,
} from './dto/experiments'

export type {
  WarningsConflict,
  WarningsListResponse,
  WarningsOpResponse,
} from './dto/warnings'

import type { WarningsConflict, WarningsListResponse, WarningsOpResponse } from './dto/warnings'

export type {
  HypothesesResponse,
  JournalCountResponse,
  JournalHistoryResponse,
  JournalInvocationRecordView,
  JournalResponse,
} from './dto/journal'

import type {
  HypothesesResponse,
  JournalCountResponse,
  JournalHistoryResponse,
  JournalResponse,
} from './dto/journal'

export type {
  FullReport,
  ReportListItem,
  ReportPutResponse,
  ReportsResponse,
} from './dto/reports'

import type { FullReport, ReportPutResponse, ReportsResponse } from './dto/reports'

export type {
  WikiBacklinksResponse,
  WikiListItem,
  WikiPageDetail,
  WikiPagesResponse,
  WikiPutResponse,
  WikiReviewCommit,
  WikiReviewResponse,
} from './dto/wiki'

import type {
  WikiBacklinksResponse,
  WikiPageDetail,
  WikiPagesResponse,
  WikiPutResponse,
  WikiReviewResponse,
} from './dto/wiki'

export type {
  CodePreview,
  CodePreviewLine,
  CodeReviewListItem,
  CodeReviewPatchResponse,
  CodeReviewProgressPatch,
  CodeReviewsResponse,
  FullCodeReview,
} from './dto/code-reviews'

import type {
  CodePreview,
  CodeReviewPatchResponse,
  CodeReviewProgressPatch,
  CodeReviewsResponse,
  FullCodeReview,
} from './dto/code-reviews'

export type {
  LogFileEntry,
  LogFilesResponse,
  LogLinesResponse,
} from './dto/logs'

import type { LogFilesResponse, LogLinesResponse } from './dto/logs'

export type {
  SlurmJobJson,
  SlurmStatus,
} from './dto/slurm'

import type { SlurmStatus } from './dto/slurm'

export type {
  CommitMark,
  CommitMarkStatus,
  CommitMarksResponse,
  GitBranchEntry,
  GitBranches,
  GitCommitDetail,
  GitCommitSummary,
  GitDiffResponse,
  GitDiffSide,
  GitDisabledReason,
  GitFileEntry,
  GitFileStatus,
  GitLog,
  GitRangeResponse,
  GitStatus,
  GitStatusFiles,
  GitSubmoduleEntry,
  GitSubmodules,
} from './dto/git'

import type {
  CommitMark,
  CommitMarkStatus,
  CommitMarksResponse,
  GitBranches,
  GitCommitDetail,
  GitDiffResponse,
  GitDiffSide,
  GitLog,
  GitRangeResponse,
  GitStatus,
  GitStatusFiles,
  GitSubmodules,
} from './dto/git'

export type {
  ComponentRunResponse,
  ComponentRunResult,
} from './dto/components'

import type { ComponentRunResponse } from './dto/components'

export type {
  CreatedShare,
  CreatedShareResponse,
  ShareRow,
  SharesResponse,
} from './dto/shares'

import {
  beginResourceRequest,
  recordResourceResponse,
  resolveNotModified,
} from './resource-protocol'

export {
  type ProjectTarget,
  projectHost,
  projectName,
  projectQueryKey,
  projectSearchParams,
  projectWebPath,
} from './project-target'

function projectQueryUrl(path: string, target: ProjectTarget, extras?: URLSearchParams): string {
  const host = projectHost(target)
  const selector = `${host ? `host=${encodeURIComponent(host)}&` : ''}project=${encodeURIComponent(projectName(target))}`
  const extraQuery = extras?.toString()
  const query = extraQuery ? `${selector}&${extraQuery}` : selector
  return `${path}?${query}`
}

function projectPathUrl(path: string, target: ProjectTarget, extras?: URLSearchParams): string {
  const host = projectHost(target)
  const selector = host
    ? `host=${encodeURIComponent(host)}&project=${encodeURIComponent(projectName(target))}`
    : ''
  const extraQuery = extras?.toString() ?? ''
  const query = [selector, extraQuery].filter(Boolean).join('&')
  return query ? `${path}?${query}` : path
}

function projectResourceUrl(path: string, target?: ProjectTarget): string {
  return target ? projectQueryUrl(path, target) : path
}

async function jsonFetch<T>(url: string, init?: RequestInit, conditional = true): Promise<T> {
  const resource = beginResourceRequest(url, init, conditional)
  const headers = new Headers(init?.headers)
  for (const [name, value] of Object.entries(resource.headers)) headers.set(name, value)
  const res = await fetch(url, { ...init, headers })
  if (res.status === 304 && resource.conditional) {
    const reuse = resolveNotModified(resource, res)
    // Returning the very same object keeps TanStack Query's data reference
    // stable, so an unchanged resource re-renders nothing at all.
    if (reuse.hit) return reuse.body as T
    // Our bounded body cache dropped the entry the server is answering
    // about; ask again without a known version.
    return jsonFetch<T>(url, init, false)
  }
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const error = (body as { error?: { message?: string; code?: string } } | null)?.error
    throw new ApiError(res.status, error?.message ?? text, error?.code ?? null)
  }
  recordResourceResponse(resource, res, body)
  return body as T
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Server-side `error.code` when the body carried one (e.g. `CONFLICT`). */
    public code: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function fetchProjects(): Promise<ProjectsResponse> {
  return jsonFetch('/api/projects')
}

export async function fetchHosts(): Promise<HostsResponse> {
  return jsonFetch('/api/hosts')
}

export async function fetchRunsInventory(
  project: ProjectTarget,
): Promise<BackendResourceInventoryResponse> {
  return jsonFetch(projectQueryUrl('/api/runs', project, new URLSearchParams({ inventory: '1' })))
}

/** Every Run of the Project, following the list's pages. */
export async function fetchExperiments(project?: ProjectTarget): Promise<RunsResponse> {
  if (!project) return jsonFetch('/api/runs')
  const experiments: RunsResponse['experiments'] = []
  let cursor: string | null = null
  do {
    const extras: URLSearchParams = new URLSearchParams(cursor === null ? {} : { cursor })
    const page: RunsResponse = await jsonFetch(projectQueryUrl('/api/runs', project, extras))
    experiments.push(...page.experiments)
    cursor = page.nextCursor ?? null
  } while (cursor !== null)
  return { experiments, nextCursor: null }
}

export async function fetchExperiment(project: ProjectTarget, id: string): Promise<FullExperiment> {
  return jsonFetch(projectQueryUrl(`/api/runs/${encodeURIComponent(id)}`, project))
}

export async function fetchHypotheses(project: ProjectTarget): Promise<HypothesesResponse> {
  return jsonFetch(projectQueryUrl('/api/hypotheses', project))
}

/** Preserved legacy `docs/journal.md` history. Read-only after the cutover. */
export async function fetchJournal(
  project: ProjectTarget,
  options: { limit?: number; before?: string } = {},
): Promise<JournalResponse> {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.before) params.set('before', options.before)
  return jsonFetch(projectQueryUrl('/api/journal', project, params))
}

/**
 * Owner-only merged diagnostics. Viewers get 401/403 from the route class, so
 * callers must treat a rejection as "not available to me", not as an outage.
 */
export async function fetchJournalHistory(
  project: ProjectTarget,
  options: { limit?: number } = {},
): Promise<JournalHistoryResponse> {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  return jsonFetch(projectQueryUrl('/api/journal/history', project, params))
}

/** Just the total event count for a project (used by the AppBar count badge). */
export async function fetchJournalCount(project: ProjectTarget): Promise<JournalCountResponse> {
  return jsonFetch(
    projectQueryUrl('/api/journal', project, new URLSearchParams({ countOnly: '1' })),
  )
}

// ---------- Reports ----------

export async function fetchReportsInventory(
  project: ProjectTarget,
): Promise<BackendResourceInventoryResponse> {
  return jsonFetch(
    projectQueryUrl('/api/reports', project, new URLSearchParams({ inventory: '1' })),
  )
}

export async function fetchReports(project: ProjectTarget): Promise<ReportsResponse> {
  return jsonFetch(projectQueryUrl('/api/reports', project))
}

export async function fetchReport(project: ProjectTarget, id: string): Promise<FullReport> {
  return jsonFetch(projectQueryUrl(`/api/reports/${encodeURIComponent(id)}`, project))
}

export async function putReport(
  project: ProjectTarget,
  id: string,
  payload: { content: string; expectedMtime: number; expectedHash: string },
): Promise<ReportPutResponse> {
  return jsonFetch(projectQueryUrl(`/api/reports/${encodeURIComponent(id)}`, project), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

// ---------- Wiki ----------

export async function fetchWiki(project: ProjectTarget): Promise<WikiPagesResponse> {
  return jsonFetch(projectQueryUrl('/api/wiki', project))
}

export async function fetchWikiInventory(
  project: ProjectTarget,
): Promise<BackendWikiInventoryResponse> {
  return jsonFetch(projectQueryUrl('/api/wiki', project, new URLSearchParams({ inventory: '1' })))
}

export async function fetchWikiPage(project: ProjectTarget, id: string): Promise<WikiPageDetail> {
  return jsonFetch(projectQueryUrl(`/api/wiki/${encodeURIComponent(id)}`, project))
}

export async function putWikiPage(
  project: ProjectTarget,
  id: string,
  payload: { content: string; expectedMtime: number; expectedHash: string },
): Promise<WikiPutResponse> {
  return jsonFetch(projectQueryUrl(`/api/wiki/${encodeURIComponent(id)}`, project), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function fetchWikiReview(project: ProjectTarget): Promise<WikiReviewResponse> {
  return jsonFetch(projectQueryUrl('/api/wiki/review', project))
}

export async function markWikiReview(
  project: ProjectTarget,
  sha: string,
  note?: string,
): Promise<WikiReviewResponse> {
  return jsonFetch(projectQueryUrl(`/api/wiki/review/${encodeURIComponent(sha)}`, project), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(note === undefined ? {} : { note }),
  })
}

export async function unmarkWikiReview(
  project: ProjectTarget,
  sha: string,
): Promise<WikiReviewResponse> {
  return jsonFetch(projectQueryUrl(`/api/wiki/review/${encodeURIComponent(sha)}`, project), {
    method: 'DELETE',
  })
}

export async function fetchWikiBacklinks(
  project: ProjectTarget,
  artifact: string,
): Promise<WikiBacklinksResponse> {
  return jsonFetch(projectQueryUrl(`/api/wiki/backlinks/${encodeURIComponent(artifact)}`, project))
}

// ---------- Code reviews ----------

// The id is the docs-relative path (it contains slashes); encode each segment
// but keep the slashes so the catch-all route still matches.
const encodeCodeReviewId = (id: string) => id.split('/').map(encodeURIComponent).join('/')

export async function fetchCodeReviewsInventory(
  project: ProjectTarget,
): Promise<BackendResourceInventoryResponse> {
  return jsonFetch(
    projectQueryUrl('/api/code-reviews', project, new URLSearchParams({ inventory: '1' })),
  )
}

export async function fetchCodeReviews(project: ProjectTarget): Promise<CodeReviewsResponse> {
  return jsonFetch(projectQueryUrl('/api/code-reviews', project))
}

export async function fetchCodeReview(project: ProjectTarget, id: string): Promise<FullCodeReview> {
  return jsonFetch(projectQueryUrl(`/api/code-reviews/${encodeCodeReviewId(id)}`, project))
}

export async function patchCodeReviewProgress(
  project: ProjectTarget,
  id: string,
  patch: CodeReviewProgressPatch,
): Promise<CodeReviewPatchResponse> {
  return jsonFetch(projectQueryUrl(`/api/code-reviews/${encodeCodeReviewId(id)}`, project), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// ---------- Code preview ----------

export async function fetchCodePreview(project: ProjectTarget, url: string): Promise<CodePreview> {
  return jsonFetch(
    `${projectQueryUrl('/api/code-preview', project)}&url=${encodeURIComponent(url)}`,
  )
}

export async function fetchLog(
  project: ProjectTarget,
  resource: string,
  legacyPath: string | undefined,
  options: { endLine?: number; count?: number } = {},
): Promise<LogLinesResponse> {
  const params = new URLSearchParams()
  const host = projectHost(project)
  if (host) {
    params.set('host', host)
    params.set('project', projectName(project))
    params.set('resource', resource)
  } else {
    params.set('path', legacyPath ?? resource)
  }
  if (options.endLine !== undefined) params.set('endLine', String(options.endLine))
  if (options.count !== undefined) params.set('count', String(options.count))
  return jsonFetch(`/api/log?${params.toString()}`)
}

export async function fetchLogFiles(
  project: ProjectTarget,
  runResource: string,
  legacyExpPath?: string,
): Promise<LogFilesResponse> {
  const host = projectHost(project)
  if (host)
    return jsonFetch(
      projectQueryUrl('/api/log-files', project, new URLSearchParams({ resource: runResource })),
    )
  return jsonFetch(`/api/log-files?expPath=${encodeURIComponent(legacyExpPath ?? runResource)}`)
}

export function logStreamUrl(
  project: ProjectTarget,
  resource: string,
  legacyPath?: string,
): string {
  const host = projectHost(project)
  if (host) {
    return projectQueryUrl('/api/log/stream', project, new URLSearchParams({ resource }))
  }
  return `/api/log/stream?path=${encodeURIComponent(legacyPath ?? resource)}`
}

export async function fetchReadme(path: string): Promise<FetchedReadme> {
  const readme = await jsonFetch<PathReadmeResponse>(`/api/readme?path=${encodeURIComponent(path)}`)
  return { resource: readme.path, content: readme.content, mtime: readme.mtime, hash: readme.hash }
}

/**
 * Fetch a v3 run README by its portable Project-scoped id.
 */
export async function fetchRunReadme(project: ProjectTarget, id: string): Promise<FetchedReadme> {
  return jsonFetch(projectQueryUrl(`/api/runs/${encodeURIComponent(id)}/readme`, project))
}

/**
 * Fetch a v3 experiment doc README by id. Returned shape matches
 * `FetchedReadme` so the editor's load handler stays uniform across modes.
 */
export async function fetchExpDocReadme(
  project: ProjectTarget,
  id: string,
): Promise<FetchedReadme> {
  return jsonFetch(projectQueryUrl(`/api/experiments/${encodeURIComponent(id)}/readme`, project))
}

export async function putExpDocReadme(input: {
  project?: ProjectTarget
  id: string
  content: string
  expectedMtime: number
  expectedHash?: string
}): Promise<PutReadmeResponse | PutReadmeConflict> {
  const res = await fetch(
    projectResourceUrl(`/api/experiments/${encodeURIComponent(input.id)}/readme`, input.project),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: input.content,
        expectedMtime: input.expectedMtime,
        expectedHash: input.expectedHash,
      }),
    },
  )
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PutReadmeResponse
}

export async function putRunReadme(input: {
  project?: ProjectTarget
  id: string
  content: string
  expectedMtime: number
  expectedHash?: string
}): Promise<PutReadmeResponse | PutReadmeConflict> {
  const res = await fetch(
    projectResourceUrl(`/api/runs/${encodeURIComponent(input.id)}/readme`, input.project),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: input.content,
        expectedMtime: input.expectedMtime,
        expectedHash: input.expectedHash,
      }),
    },
  )
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PutReadmeResponse
}

export async function putReadme(input: {
  path: string
  content: string
  expectedMtime: number
  expectedHash?: string
}): Promise<PutReadmeResponse | PutReadmeConflict> {
  const res = await fetch('/api/readme', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PutReadmeResponse
}

export async function patchExperimentStatus(input: {
  project?: ProjectTarget
  id: string
  status: string
  expectedMtime: number
  expectedHash?: string
}): Promise<PatchStatusResponse | PutReadmeConflict | PatchStatusForbidden> {
  const res = await fetch(
    projectResourceUrl(`/api/runs/${encodeURIComponent(input.id)}/status`, input.project),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: input.status,
        expectedMtime: input.expectedMtime,
        expectedHash: input.expectedHash,
      }),
    },
  )
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (res.status === 422 && body?.error?.code === 'ARCHIVE_RUNNING_FORBIDDEN') {
    return body as PatchStatusForbidden
  }
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PatchStatusResponse
}

// ---------- v4 archive toggle ----------

export async function patchRunArchived(input: {
  project?: ProjectTarget
  id: string
  archived: boolean
  expectedMtime?: number
}): Promise<PatchArchiveResponse | PatchArchiveForbidden | PutReadmeConflict> {
  const res = await fetch(
    projectResourceUrl(`/api/runs/${encodeURIComponent(input.id)}/archive`, input.project),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: input.archived, expectedMtime: input.expectedMtime }),
    },
  )
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (res.status === 422 && body?.error?.code === 'ARCHIVE_RUNNING_FORBIDDEN') {
    return body as PatchArchiveForbidden
  }
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PatchArchiveResponse
}

export async function patchExperimentStatusV4(input: {
  project?: ProjectTarget
  id: string
  status: 'OPEN' | 'RESOLVED' | 'ABANDONED'
  expectedMtime: number
}): Promise<PatchExperimentStatusResponse | PutReadmeConflict> {
  const res = await fetch(
    projectResourceUrl(`/api/experiments/${encodeURIComponent(input.id)}/status`, input.project),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: input.status, expectedMtime: input.expectedMtime }),
    },
  )
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PatchExperimentStatusResponse
}

export async function patchExperimentArchived(input: {
  project?: ProjectTarget
  id: string
  archived: boolean
  expectedMtime?: number
}): Promise<PatchArchiveResponse | PutReadmeConflict> {
  const res = await fetch(
    projectResourceUrl(`/api/experiments/${encodeURIComponent(input.id)}/archive`, input.project),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: input.archived, expectedMtime: input.expectedMtime }),
    },
  )
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PatchArchiveResponse
}

async function _jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json()
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`
    throw new ApiError(res.status, msg)
  }
  return body as T
}

// ---------- Warnings ----------

export async function fetchWarnings(
  project: ProjectTarget,
  id: string,
): Promise<WarningsListResponse> {
  return jsonFetch(projectQueryUrl(`/api/runs/${encodeURIComponent(id)}/warnings`, project))
}

export async function postWarning(
  project: ProjectTarget,
  id: string,
  input: { category: string; message: string; expectedMtime?: number; expectedHash?: string },
): Promise<WarningsOpResponse | WarningsConflict> {
  const res = await fetch(
    projectQueryUrl(`/api/runs/${encodeURIComponent(id)}/warnings`, project),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  const body = await res.json()
  if (res.status === 409) return body as WarningsConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as WarningsOpResponse
}

export async function patchWarningApi(
  project: ProjectTarget,
  id: string,
  rowId: string,
  input: { op: 'resolve' | 'reopen'; note?: string; expectedMtime?: number; expectedHash?: string },
): Promise<WarningsOpResponse | WarningsConflict> {
  const res = await fetch(
    projectQueryUrl(
      `/api/runs/${encodeURIComponent(id)}/warnings/${encodeURIComponent(rowId)}`,
      project,
    ),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  const body = await res.json()
  if (res.status === 409) return body as WarningsConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as WarningsOpResponse
}

export async function deleteWarningApi(
  project: ProjectTarget,
  id: string,
  rowId: string,
  input: { expectedMtime?: number; expectedHash?: string },
): Promise<WarningsOpResponse | WarningsConflict> {
  const res = await fetch(
    projectQueryUrl(
      `/api/runs/${encodeURIComponent(id)}/warnings/${encodeURIComponent(rowId)}`,
      project,
    ),
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  const body = await res.json()
  if (res.status === 409) return body as WarningsConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as WarningsOpResponse
}

// ---------- v3 experiment-doc ----------

export async function fetchExperimentsInventory(
  project: ProjectTarget,
): Promise<BackendResourceInventoryResponse> {
  return jsonFetch(
    projectQueryUrl('/api/experiments', project, new URLSearchParams({ inventory: '1' })),
  )
}

export async function fetchExperimentDocs(
  project?: ProjectTarget,
): Promise<ExperimentDocsResponse> {
  const url = project ? projectQueryUrl('/api/experiments', project) : '/api/experiments'
  return jsonFetch(url)
}

export async function fetchExperimentDoc(
  project: ProjectTarget,
  id: string,
): Promise<ExperimentDocDetail> {
  return jsonFetch(projectQueryUrl(`/api/experiments/${encodeURIComponent(id)}`, project))
}

export async function createExperimentDoc(
  project: ProjectTarget,
  input: {
    slug: string
    title?: string
    hypotheses?: string[]
    tags?: string[]
    fromRun?: string | null
    fromRunExpectedMtime?: number
    fromRunExpectedHash?: string
  },
): Promise<ExperimentCreateResponse> {
  return jsonFetch(projectQueryUrl('/api/experiments', project), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: projectName(project), ...input }),
  })
}

export async function bindExperimentRun(
  operation: 'link' | 'unlink',
  project: ProjectTarget,
  id: string,
  input: ExperimentBindInput,
): Promise<ExperimentBindResponse> {
  return jsonFetch(
    projectQueryUrl(`/api/experiments/${encodeURIComponent(id)}/${operation}`, project),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function deleteExperimentDoc(
  project: ProjectTarget,
  id: string,
  input: {
    force: boolean
    expectedMtime: number
    expectedHash: string
    runLocks: Array<{ run: string; expectedMtime: number; expectedHash: string }>
  },
): Promise<ExperimentDeleteResponse> {
  const query = new URLSearchParams({ force: String(input.force) })
  return jsonFetch(projectQueryUrl(`/api/experiments/${encodeURIComponent(id)}`, project, query), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedMtime: input.expectedMtime,
      expectedHash: input.expectedHash,
      runLocks: input.runLocks,
    }),
  })
}

export async function fetchExperimentResults(
  project: ProjectTarget,
  id: string,
): Promise<ExperimentResultsSnapshot> {
  return jsonFetch(projectQueryUrl(`/api/experiments/${encodeURIComponent(id)}/results`, project), {
    cache: 'no-store',
  })
}

export async function fetchRunFiles(
  project: ProjectTarget,
  id: string,
  depth = 3,
): Promise<RunFilesResponse> {
  return jsonFetch(
    projectQueryUrl(
      `/api/runs/${encodeURIComponent(id)}/files`,
      project,
      new URLSearchParams({ depth: String(depth) }),
    ),
  )
}

// Slurm widget — one fetch every 30s while the sidebar footer is mounted.

export async function fetchSlurmStatus(): Promise<SlurmStatus> {
  const res = await fetch('/api/slurm/status')
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new ApiError(res.status, `unparseable response: ${text.slice(0, 200)}`)
  }
  if (res.ok) return body as SlurmStatus
  // 500-with-JSON-error case: surface the structured error rather than throwing.
  if (
    body !== null &&
    typeof body === 'object' &&
    'enabled' in body &&
    (body as { enabled: unknown }).enabled === true &&
    'error' in body
  ) {
    return body as SlurmStatus
  }
  throw new ApiError(res.status, (body as { error?: { message?: string } })?.error?.message ?? text)
}

// Git status — per-project working-tree state. Polled by sidebar + project footer.

export async function fetchGitStatus(project: ProjectTarget): Promise<GitStatus> {
  return jsonFetch(
    projectPathUrl(`/api/projects/${encodeURIComponent(projectName(project))}/git-status`, project),
  )
}

// Git status — detailed file lists. Fetched lazily once per dialog open.

export async function fetchGitStatusFiles(
  project: ProjectTarget,
  submodule?: string,
): Promise<GitStatusFiles> {
  const params = new URLSearchParams()
  if (submodule) params.set('submodule', submodule)
  return jsonFetch(
    projectPathUrl(
      `/api/projects/${encodeURIComponent(projectName(project))}/git-status/files`,
      project,
      params,
    ),
  )
}

// Per-file diff payload. Side encodes which pair of refs the dialog is
// asking about: staged = HEAD vs index, unstaged = index vs working,
// untracked = empty vs working.

export interface FetchGitDiffOpts {
  sha?: string
  submodule?: string
  from?: string
  to?: string
}

export async function fetchGitDiff(
  project: ProjectTarget,
  path: string,
  side: GitDiffSide,
  opts: FetchGitDiffOpts = {},
): Promise<GitDiffResponse> {
  const params = new URLSearchParams({ path, side })
  if (opts.sha) params.set('sha', opts.sha)
  if (opts.submodule) params.set('submodule', opts.submodule)
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  return jsonFetch(
    projectPathUrl(
      `/api/projects/${encodeURIComponent(projectName(project))}/git-diff`,
      project,
      params,
    ),
  )
}

// Git range — commit list AND file list for `from..to`. Used by the
// submodule-bump expander on a main-repo commit's gitlink entry: lazily
// fetches what changed inside the submodule between the two pinned SHAs.
// Always scoped to a submodule cwd in practice (the main-repo bump entry
// only opens a range view for the submodule), but the endpoint accepts
// either.

export async function fetchGitRange(
  project: ProjectTarget,
  from: string,
  to: string,
  submodule?: string,
): Promise<GitRangeResponse> {
  const params = new URLSearchParams({ from, to })
  if (submodule) params.set('submodule', submodule)
  return jsonFetch(
    projectPathUrl(
      `/api/projects/${encodeURIComponent(projectName(project))}/git-range`,
      project,
      params,
    ),
  )
}

// Git history — branches, commit list, single-commit detail. Lazy
// (fetched on dialog open / branch change / commit click).

export async function fetchGitBranches(
  project: ProjectTarget,
  submodule?: string,
): Promise<GitBranches> {
  const params = new URLSearchParams()
  if (submodule) params.set('submodule', submodule)
  return jsonFetch(
    projectPathUrl(
      `/api/projects/${encodeURIComponent(projectName(project))}/git-branches`,
      project,
      params,
    ),
  )
}

export async function fetchGitLog(
  project: ProjectTarget,
  ref: string,
  limit?: number,
  submodule?: string,
): Promise<GitLog> {
  const params = new URLSearchParams({ ref })
  if (limit !== undefined) params.set('limit', String(limit))
  if (submodule) params.set('submodule', submodule)
  return jsonFetch(
    projectPathUrl(
      `/api/projects/${encodeURIComponent(projectName(project))}/git-log`,
      project,
      params,
    ),
  )
}

export async function fetchGitCommit(
  project: ProjectTarget,
  sha: string,
  submodule?: string,
): Promise<GitCommitDetail> {
  const params = new URLSearchParams({ sha })
  if (submodule) params.set('submodule', submodule)
  return jsonFetch(
    projectPathUrl(
      `/api/projects/${encodeURIComponent(projectName(project))}/git-commit`,
      project,
      params,
    ),
  )
}

// --- Submodules ---

export async function fetchSubmodules(project: ProjectTarget): Promise<GitSubmodules> {
  return jsonFetch(
    projectPathUrl(`/api/projects/${encodeURIComponent(projectName(project))}/submodules`, project),
  )
}

// Commit verification marks — per-project CSV stored under `.memon/`.

export async function fetchCommitMarks(project: ProjectTarget): Promise<CommitMarksResponse> {
  return jsonFetch(
    projectPathUrl(
      `/api/projects/${encodeURIComponent(projectName(project))}/commit-marks`,
      project,
    ),
  )
}

function commitMarkUrl(project: ProjectTarget, sha: string, submodule?: string): string {
  const base = `/api/projects/${encodeURIComponent(projectName(project))}/commit-marks/${encodeURIComponent(sha)}`
  const qualified = projectPathUrl(base, project)
  if (!submodule) return qualified
  return `${qualified}${qualified.includes('?') ? '&' : '?'}submodule=${encodeURIComponent(submodule)}`
}

export async function setCommitMark(
  project: ProjectTarget,
  sha: string,
  input: { status: CommitMarkStatus; note?: string },
  submodule?: string,
): Promise<{ mark: CommitMark }> {
  return jsonFetch(commitMarkUrl(project, sha, submodule), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function deleteCommitMark(
  project: ProjectTarget,
  sha: string,
  submodule?: string,
): Promise<{ deleted: boolean }> {
  return jsonFetch(commitMarkUrl(project, sha, submodule), { method: 'DELETE' })
}

// Re-exports for convenience
export type { Hypothesis, JournalEvent, Run, WarningRecord }

/** Explicitly recompute one or more executable component blocks. */
export async function runComponents(
  project: ProjectTarget | { project: string; host?: string },
  input: { document: string; ids?: readonly string[] },
): Promise<ComponentRunResponse> {
  const name = typeof project === 'string' ? project : project.project
  const host = typeof project === 'string' ? undefined : project.host
  return jsonFetch('/api/components/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      project: name,
      ...(host ? { host } : {}),
      document: input.document,
      ...(input.ids ? { ids: input.ids } : {}),
    }),
  })
}
