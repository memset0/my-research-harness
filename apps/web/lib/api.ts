// Thin fetch wrappers for the /api/* routes. Used via TanStack Query.
// We `import type` for everything so the @memon/core JS module never enters
// the client bundle (it transitively pulls in fast-glob → fs).

import type {
  BackendResourceInventoryResponse,
  BackendWikiInventoryResponse,
  CodeReviewCompletion,
  CodeReviewFrontMatter,
  CodeReviewSummary,
  ExperimentDocumentDiagnostic,
  ExperimentRawSection,
  HostAvailability,
  Hypothesis,
  ImplementationDocument,
  InvestigationDocument,
  JournalEvent,
  ParsedHypotheses,
  ParsedJournal,
  ParseIssue,
  ProjectRef,
  ReportSummary,
  ResultsDocument,
  Run,
  WarningRecord,
  WikiBacklink,
  WikiPage,
  WikiSummary,
} from '@memon/core'
import {
  beginResourceRequest,
  recordResourceResponse,
  resolveNotModified,
} from './resource-protocol'

export type ProjectTarget = string | ProjectRef

export function projectName(target: ProjectTarget): string {
  return typeof target === 'string' ? target : target.project
}

export function projectHost(target: ProjectTarget): string | null {
  return typeof target === 'string' ? null : target.host
}

export function projectSearchParams(target: ProjectTarget): URLSearchParams {
  const params = new URLSearchParams()
  const host = projectHost(target)
  if (host) params.set('host', host)
  params.set('project', projectName(target))
  return params
}

export function projectQueryKey(
  target: ProjectTarget,
): readonly [project: string] | readonly [host: string, project: string] {
  const host = projectHost(target)
  return host ? ([host, projectName(target)] as const) : ([projectName(target)] as const)
}

/** Canonical browser path for a standalone or Host-qualified Project. */
export function projectWebPath(target: ProjectTarget, suffix = ''): string {
  if (suffix !== '' && !suffix.startsWith('/')) {
    throw new Error('Project path suffix must be empty or start with /')
  }
  const project = encodeURIComponent(projectName(target))
  const host = projectHost(target)
  const base = host ? `/h/${encodeURIComponent(host)}/p/${project}` : `/p/${project}`
  return `${base}${suffix}`
}

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

export interface StandaloneProjectSummary {
  mode: 'standalone'
  host: null
  project: string
  name: string
  root: string
  exclude: string[]
}

export type CentralProjectSummary = ProjectRef & {
  mode: 'central'
  name: string
  label?: string
  description?: string
  root?: never
  exclude?: never
}

export type ProjectSummary = StandaloneProjectSummary | CentralProjectSummary

export interface IndexedRun
  extends Pick<
    Run,
    | 'id'
    | 'project'
    | 'mtime'
    | 'readmeMtime'
    | 'hasReadme'
    | 'frontMatter'
    | 'parseErrors'
    | 'parseWarnings'
  > {
  /** Standalone-only absolute directory; central uses portable resource. */
  path?: string
  resource?: string
  stale: boolean
}

export interface FullExperiment
  extends Pick<
    Run,
    | 'id'
    | 'project'
    | 'mtime'
    | 'readmeMtime'
    | 'hasReadme'
    | 'frontMatter'
    | 'sections'
    | 'body'
    | 'parseErrors'
    | 'parseWarnings'
  > {
  /** Standalone-only absolute directory; central uses portable resource. */
  path?: string
  resource?: string
  stale: boolean
  resources: null
  warnings: WarningRecord[]
  warningsRaw: string | null
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
    throw new ApiError(
      res.status,
      (body as { error?: { message?: string } })?.error?.message ?? text,
    )
  }
  recordResourceResponse(resource, res, body)
  return body as T
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function fetchProjects(): Promise<{ projects: ProjectSummary[] }> {
  return jsonFetch('/api/projects')
}

export interface HostsResponse {
  hosts: Array<HostAvailability & { label?: string }>
}

export async function fetchHosts(): Promise<HostsResponse> {
  return jsonFetch('/api/hosts')
}

export async function fetchRunsInventory(
  project: ProjectTarget,
): Promise<BackendResourceInventoryResponse> {
  return jsonFetch(projectQueryUrl('/api/runs', project, new URLSearchParams({ inventory: '1' })))
}

export async function fetchExperiments(
  project?: ProjectTarget,
): Promise<{ experiments: IndexedRun[] }> {
  const url = project ? projectQueryUrl('/api/runs', project) : '/api/runs'
  return jsonFetch(url)
}

export async function fetchExperiment(project: ProjectTarget, id: string): Promise<FullExperiment> {
  return jsonFetch(projectQueryUrl(`/api/runs/${encodeURIComponent(id)}`, project))
}

/** Named response contracts for content-bearing project collections. */
export type HypothesesResponse = { path?: string } & ParsedHypotheses

export interface JournalCountResponse {
  totalEvents: number
}

export interface JournalInvocationRecordView {
  version: number
  id: string
  startedAt: string
  finishedAt: string | null
  command: string
  origin: 'cli' | 'web'
  parameters: Record<string, unknown>
  outcome: 'running' | 'success' | 'failure' | 'conflict' | 'noop' | 'partial'
  errorCode?: string
  details?: Array<Record<string, unknown>>
}

export interface JournalHistoryResponse {
  project: string
  legacy: {
    present: boolean
    events: JournalEvent[]
    parseErrors: ParsedJournal['parseErrors']
    parseWarnings: ParsedJournal['parseWarnings']
  }
  invocations: JournalInvocationRecordView[]
  unreadableReceipts: Array<{ file: string; reason: string }>
}

export async function fetchHypotheses(project: ProjectTarget): Promise<HypothesesResponse> {
  return jsonFetch(projectQueryUrl('/api/hypotheses', project))
}

/** Preserved legacy `docs/journal.md` history. Read-only after the cutover. */
export async function fetchJournal(
  project: ProjectTarget,
  options: { limit?: number; before?: string } = {},
): Promise<{ path?: string } & Omit<ParsedJournal, 'lastDigestAt'>> {
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

export interface FullReport {
  id: string
  slug: string
  /** Standalone-only absolute path; central Backend responses deliberately omit it. */
  path?: string
  resource?: string
  mtime: number
  hash: string
  content: string
  format: 'markdown' | 'bundle'
}

export interface ReportListItem extends Omit<ReportSummary, 'path'> {
  /** Standalone-only absolute path; never crosses the Backend boundary. */
  path?: string
  resource?: string
  format: 'markdown' | 'bundle'
}

export interface ReportsResponse {
  reports: ReportListItem[]
}

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
): Promise<{ ok: true; mtime: number; hash: string }> {
  return jsonFetch(projectQueryUrl(`/api/reports/${encodeURIComponent(id)}`, project), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

// ---------- Wiki ----------

/**
 * Standalone serves the core projection (with its project-relative `path`)
 * plus the `project` / `resource` pair; a Host-scoped Backend response omits
 * `path` and carries `resource` only. Read the location as
 * `page.resource ?? page.path`.
 */
export type WikiListItem = Omit<WikiSummary, 'path'> & {
  project: string
  path?: string
  resource?: string
}

export type WikiPageDetail = Omit<WikiPage, 'path'> & {
  project: string
  path?: string
  resource?: string
}

export interface WikiPagesResponse {
  pages: WikiListItem[]
}

export interface WikiPutResponse {
  ok: true
  mtime: number
  hash: string
  page: WikiPageDetail
  /** Content as written — the editor re-baselines its buffer from this. */
  finalContent: string
}

export interface WikiReviewCommit {
  sha: string
  authoredAt: string
  subject: string
  /** Page ids the commit touched. */
  pages: string[]
  verified: boolean
  verifiedAt: string | null
  note: string | null
}

export interface WikiReviewResponse {
  /** Newest sequentially verified wiki commit, or null when none is marked. */
  verifiedThrough: string | null
  /** Wiki commits, oldest first. */
  commits: WikiReviewCommit[]
}

export interface WikiBacklinksResponse {
  artifact: string
  pages: WikiBacklink[]
}

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

export interface FullCodeReview {
  id: string
  scope: 'project' | 'experiment'
  experiment: string | null
  frontmatter: CodeReviewFrontMatter
  body: string
  mtime: number
  hash: string
  completion: CodeReviewCompletion
}

export type CodeReviewProgressPatch =
  | { op: 'commit'; sha: string; reviewed: boolean; expectedMtime: number; expectedHash: string }
  | { op: 'todo'; index: number; done: boolean; expectedMtime: number; expectedHash: string }

// The id is the docs-relative path (it contains slashes); encode each segment
// but keep the slashes so the catch-all route still matches.
const encodeCodeReviewId = (id: string) => id.split('/').map(encodeURIComponent).join('/')

export interface CodeReviewsResponse {
  codeReviews: CodeReviewListItem[]
}

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

export type CodeReviewListItem = Omit<CodeReviewSummary, 'path'> & {
  path?: string
  resource?: string
}

export async function fetchCodeReview(project: ProjectTarget, id: string): Promise<FullCodeReview> {
  return jsonFetch(projectQueryUrl(`/api/code-reviews/${encodeCodeReviewId(id)}`, project))
}

export async function patchCodeReviewProgress(
  project: ProjectTarget,
  id: string,
  patch: CodeReviewProgressPatch,
): Promise<{ ok: true; mtime: number; hash: string; completion: CodeReviewCompletion }> {
  return jsonFetch(projectQueryUrl(`/api/code-reviews/${encodeCodeReviewId(id)}`, project), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// ---------- Code preview ----------

export interface CodePreviewLine {
  n: number
  text: string
  target: boolean
}

export interface CodePreview {
  owner: string
  repo: string
  sha: string
  path: string
  startLine: number
  endLine: number
  lines: CodePreviewLine[]
  truncated: boolean
  // Set when the link resolved but the bytes couldn't be previewed
  // (e.g. the file is too large or binary). `lines` is empty in that case.
  reason?: 'too-large' | 'binary'
}

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
): Promise<{ totalLines: number; lines: { lineNumber: number; text: string }[] }> {
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

export interface LogFileEntry {
  name: string
  path?: string
  resource?: string
  size: number
  mtime: number
}

export async function fetchLogFiles(
  project: ProjectTarget,
  runResource: string,
  legacyExpPath?: string,
): Promise<{ files: LogFileEntry[] }> {
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

export interface PutReadmeResponse {
  mtime: number
  hash?: string
  /**
   * The canonical on-disk content after the server bumped `updated_at`
   * and re-serialized via the pretty-printer. Editors should rebaseline
   * their buffer to this exact string so dirty-state clears.
   */
  finalContent?: string
}
export interface PutReadmeConflict {
  error: { code: 'CONFLICT'; message: string }
  mtime: number
  content: string
}

export interface FetchedReadme {
  resource: string
  content: string
  mtime: number
  hash: string
}

export async function fetchReadme(path: string): Promise<FetchedReadme> {
  const readme = await jsonFetch<Omit<FetchedReadme, 'resource'> & { path: string }>(
    `/api/readme?path=${encodeURIComponent(path)}`,
  )
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

export interface PatchStatusResponse {
  mtime: number
  prevStatus?: string
  nextStatus?: string
  unchanged?: boolean
  /** v4: present when the on-disk pre-write archived was true. */
  warning?: 'archived'
}

export interface PatchStatusForbidden {
  error: { code: 'ARCHIVE_RUNNING_FORBIDDEN'; message: string; id?: string }
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

export interface PatchArchiveResponse {
  ok: true
  archived: boolean
  mtime: number
  noop?: boolean
}

export interface PatchArchiveForbidden {
  error: { code: 'ARCHIVE_RUNNING_FORBIDDEN'; message: string; id?: string }
}

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

export interface PatchExperimentStatusResponse {
  mtime: number
  prevStatus?: string
  nextStatus?: string
  unchanged?: boolean
  warning?: 'archived'
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

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json()
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`
    throw new ApiError(res.status, msg)
  }
  return body as T
}

// ---------- Warnings ----------

export interface WarningsListResponse {
  ok: true
  warnings: WarningRecord[]
  mtime: number
  hash: string
}

export interface WarningsOpResponse {
  ok: true
  rowId?: string
  warnings: WarningRecord[]
  mtime: number
  hash: string
}

export interface WarningsConflict {
  error: { code: 'CONFLICT' | 'WARNINGS_SECTION_NOT_TABLE'; message: string }
  mtime?: number
  hash?: string
  content?: string
}

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

export interface ExperimentDocSummary {
  id: string
  project: string
  /** Standalone-only absolute path; central Backend responses deliberately omit it. */
  path?: string
  resource?: string
  /** Bundle activity mtime (README + managed YAML); display/sorting only. */
  mtime: number
  /** README.md's own mtime; optimistic-lock key for README mutations. */
  readmeMtime: number
  frontMatter: {
    id: string
    slug: string
    title: string
    /** v4: ExperimentStatus enum from frontmatter. */
    status: 'OPEN' | 'RESOLVED' | 'ABANDONED'
    /** v4: archived flag from frontmatter. */
    archived: boolean
    runs: string[]
    hypotheses: string[]
    tags: string[]
    createdAt: string
    updatedAt: string
  }
  sections: {
    motivation: string | null
    design?: string | null
    implementation?: string | null
    investigation?: string | null
    results?: string | null
    findings?: string | null
    limitations?: string | null
    method: string | null
    plan: string | null
    conclusion: string | null
    caveats: string | null
  }
  warningsRaw: string | null
  parseErrors: { message: string }[]
  parseWarnings: { message: string }[]
  effectiveCreatedAt: string
  effectiveUpdatedAt: string
}

export interface ExperimentDisplaySection extends ExperimentRawSection {
  /** Human-readable Markdown; a valid managed section is rendered from YAML. */
  body: string
  /** Literal README body retained when `body` is a YAML projection. */
  rawBody: string
  source: 'readme' | 'yaml' | 'diagnostic'
  diagnostics: ExperimentDocumentDiagnostic[]
}

export interface ExperimentManagedDocumentPayload<T> {
  kind: 'implementation' | 'investigation' | 'results'
  fileName: string
  resource: string
  exists: boolean
  data: T | null
  parseErrors: ParseIssue[]
  parseWarnings: ParseIssue[]
}

export interface ResultsVariantEligibilityPayload {
  variantId: string
  runs: string[]
  deprecatedRuns: string[]
  eligibleRuns: string[]
  hasMetrics: boolean
  metricsValidity: 'valid' | 'partial' | 'unavailable'
}

export interface ExperimentManagedDocumentsPayload {
  implementation: ExperimentManagedDocumentPayload<ImplementationDocument> & {
    kind: 'implementation'
  }
  investigation: ExperimentManagedDocumentPayload<InvestigationDocument> & {
    kind: 'investigation'
  }
  results: ExperimentManagedDocumentPayload<ResultsDocument> & {
    kind: 'results'
    /**
     * Read-time evidence state per Variant, projected from Run deprecation.
     * `partial` / `unavailable` metrics are the recorded numbers, unchanged
     * and unreplaced, but they are NOT current evidence: a view must not
     * present them as comparable or as a best result.
     */
    variantEligibility: ResultsVariantEligibilityPayload[]
  }
}

/**
 * Detail (`/api/experiments/:id`). The Experiment document and its managed
 * documents only — the member roster is `frontMatter.runs`, and each Run's
 * own content is read from the Run endpoints when its panel is opened.
 */
export interface ExperimentDocDetail extends ExperimentDocSummary {
  /** Read-time visibility metadata; the declared frontmatter roster stays intact. */
  deprecatedRuns: string[]
  rawSections: ExperimentRawSection[]
  documents: ExperimentManagedDocumentsPayload | null
  documentSections: ExperimentDisplaySection[]
  documentDiagnostics: ExperimentDocumentDiagnostic[]
  documentReadOnly: boolean
  resultsUpdatedAt: string | null
}

export interface ExperimentResultsSnapshot {
  project: string
  resource: string
  document: ResultsDocument
  deprecatedRuns: string[]
  variantEligibility: ResultsVariantEligibilityPayload[]
  updatedAt: string
  warnings: ParseIssue[]
}

export interface ExperimentDocsResponse {
  experiments: ExperimentDocSummary[]
}

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
): Promise<{ ok: true; id: string; resource: string; mtime: number; hash: string }> {
  return jsonFetch(projectQueryUrl('/api/experiments', project), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: projectName(project), ...input }),
  })
}

export interface ExperimentBindInput {
  run: string
  expectedMtime: number
  expectedHash: string
  expectedRunMtime: number
  expectedRunHash: string
}

export async function bindExperimentRun(
  operation: 'link' | 'unlink',
  project: ProjectTarget,
  id: string,
  input: ExperimentBindInput,
): Promise<{
  ok: true
  experimentId: string
  runId: string
  experimentMtime: number
  experimentHash: string
  runMtime: number
  runHash: string
}> {
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
): Promise<{ ok: true; deletedId: string; cascadedRuns: string[] }> {
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

export interface RunFileTreeNode {
  type: 'file' | 'dir'
  resource: string
  size?: number
  mtime?: number
  children?: RunFileTreeNode[]
}

export async function fetchRunFiles(
  project: ProjectTarget,
  id: string,
  depth = 3,
): Promise<{
  project: string
  runId: string
  resource: string
  depth: number
  truncated: boolean
  entries: number
  tree: RunFileTreeNode
}> {
  return jsonFetch(
    projectQueryUrl(
      `/api/runs/${encodeURIComponent(id)}/files`,
      project,
      new URLSearchParams({ depth: String(depth) }),
    ),
  )
}

// Slurm widget — one fetch every 30s while the sidebar footer is mounted.

export interface SlurmJobJson {
  jobId: string
  partition: string
  name: string
  state: string
  time: string
  numNodes: number
  nodeList: string
}

export type SlurmStatus =
  | { enabled: false }
  | {
      enabled: true
      totalNodes: number
      usedNodes: number
      jobs: SlurmJobJson[]
    }
  | {
      enabled: true
      error: { code: 'SLURM_UNAVAILABLE'; message: string }
    }

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

export type GitStatus =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | {
      enabled: true
      branch: string | null
      detached: boolean
      sha: string
      upstream: string | null
      ahead: number
      behind: number
      staged: number
      unstaged: number
      untracked: number
      dirty: boolean
    }

export async function fetchGitStatus(project: ProjectTarget): Promise<GitStatus> {
  return jsonFetch(
    projectPathUrl(`/api/projects/${encodeURIComponent(projectName(project))}/git-status`, project),
  )
}

// Git status — detailed file lists. Fetched lazily once per dialog open.

export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflict'
  | 'typechange'

export interface GitFileEntry {
  path: string
  status: GitFileStatus
  origPath?: string
  /**
   * Set when this file is a submodule-pointer bump (a gitlink entry in
   * `git diff-tree --raw` with old mode `160000` and new mode `160000`).
   * Carries the two SHAs the submodule pointer is being changed between,
   * so the UI can expand this row into a `git-range` view of the
   * submodule's actual commits between `fromSha..toSha`.
   */
  submoduleBump?: { fromSha: string; toSha: string }
}

export type GitStatusFiles =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | {
      enabled: true
      branch: string | null
      detached: boolean
      sha: string
      upstream: string | null
      ahead: number
      behind: number
      staged: GitFileEntry[]
      unstaged: GitFileEntry[]
      untracked: GitFileEntry[]
    }

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

export type GitDiffSide = 'staged' | 'unstaged' | 'untracked' | 'commit' | 'range'

export type GitDiffResponse =
  | {
      ok: true
      filename: string
      status: GitFileStatus
      oldContent: string | null
      newContent: string | null
    }
  | {
      ok: false
      skipReason: 'too-large'
      sizeBytes: number
      maxBytes: number
      side: 'old' | 'new'
    }
  | { ok: false; skipReason: 'binary' }
  | { ok: false; error: { message: string } }

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

export type GitRangeResponse =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | {
      enabled: true
      from: string
      to: string
      commits: GitCommitSummary[]
      files: GitFileEntry[]
      submodule: string
    }

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

export interface GitBranchEntry {
  name: string
  sha: string
  isCurrent: boolean
}

export type GitBranches =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | {
      enabled: true
      current: string | null
      detached: boolean
      sha: string
      branches: GitBranchEntry[]
    }

export interface GitCommitSummary {
  sha: string
  shortSha: string
  subject: string
  authorName: string
  authorEmail: string
  authorDate: string
  parents: string[]
}

export type GitLog =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | { enabled: true; commits: GitCommitSummary[] }

export type GitCommitDetail =
  | {
      enabled: false
      reason: 'not-a-repo' | 'git-not-found' | 'timeout' | 'not-found' | 'error'
      message?: string
    }
  | {
      enabled: true
      sha: string
      shortSha: string
      subject: string
      body: string
      authorName: string
      authorEmail: string
      authorDate: string
      parents: string[]
      files: GitFileEntry[]
    }

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

export interface GitSubmoduleEntry {
  name: string
  path: string
}

export type GitSubmodules =
  | {
      enabled: false
      reason: 'not-a-repo' | 'no-gitmodules' | 'git-not-found' | 'timeout' | 'error'
      message?: string
    }
  | { enabled: true; submodules: GitSubmoduleEntry[] }

export async function fetchSubmodules(project: ProjectTarget): Promise<GitSubmodules> {
  return jsonFetch(
    projectPathUrl(`/api/projects/${encodeURIComponent(projectName(project))}/submodules`, project),
  )
}

// Commit verification marks — per-project CSV stored under `.memon/`.

export type CommitMarkStatus = 'verified' | 'suspicious' | 'issue'

export interface CommitMark {
  sha: string
  status: CommitMarkStatus
  note: string
  updatedAt: string
  /** Empty string = main repo; otherwise the submodule name from `.gitmodules`. */
  submodule: string
}

export interface CommitMarksResponse {
  marks: CommitMark[]
  parseWarnings: string[]
}

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
