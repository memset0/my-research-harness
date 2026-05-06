// Thin fetch wrappers for the /api/* routes. Used via TanStack Query.
// We `import type` for everything so the @memon/core JS module never enters
// the client bundle (it transitively pulls in fast-glob → fs).

import type {
  DigestSummary,
  Run,
  Hypothesis,
  JournalEvent,
  ParsedHypotheses,
  ParsedJournal,
  ReportSummary,
  WarningRecord,
} from '@memon/core'

export interface ProjectSummary {
  name: string
  root: string
  exclude: string[]
}

export interface IndexedRun
  extends Pick<Run, 'id' | 'project' | 'path' | 'mtime' | 'hasReadme' | 'frontMatter' | 'parseErrors' | 'parseWarnings'> {
  stale: boolean
}

export interface FullExperiment
  extends Pick<
    Run,
    'id' | 'project' | 'path' | 'mtime' | 'hasReadme' | 'frontMatter' | 'sections' | 'body' | 'parseErrors' | 'parseWarnings'
  > {
  stale: boolean
  resources: null
  warnings: WarningRecord[]
  warningsRaw: string | null
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: { message?: string } })?.error?.message ?? text)
  }
  return body as T
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function fetchProjects(): Promise<{ projects: ProjectSummary[] }> {
  return jsonFetch('/api/projects')
}

export async function fetchExperiments(project?: string): Promise<{ experiments: IndexedRun[] }> {
  const url = project ? `/api/runs?project=${encodeURIComponent(project)}` : '/api/runs'
  return jsonFetch(url)
}

export async function fetchExperiment(id: string): Promise<FullExperiment> {
  return jsonFetch(`/api/runs/${encodeURIComponent(id)}`)
}

export async function fetchHypotheses(project: string): Promise<{ path: string } & ParsedHypotheses> {
  return jsonFetch(`/api/hypotheses?project=${encodeURIComponent(project)}`)
}

export async function fetchJournal(
  project: string,
  options: { limit?: number; before?: string } = {},
): Promise<{ path: string } & ParsedJournal> {
  const params = new URLSearchParams({ project })
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.before) params.set('before', options.before)
  return jsonFetch(`/api/journal?${params.toString()}`)
}

/** Just the total event count for a project (used by the AppBar count badge). */
export async function fetchJournalCount(
  project: string,
): Promise<{ totalEvents: number; lastDigestAt: string | null }> {
  return jsonFetch(`/api/journal?project=${encodeURIComponent(project)}&countOnly=1`)
}

// ---------- Reports ----------

export interface FullReport {
  id: string
  slug: string
  path: string
  mtime: number
  hash: string
  content: string
}

export async function fetchReports(project: string): Promise<{ reports: ReportSummary[] }> {
  return jsonFetch(`/api/reports?project=${encodeURIComponent(project)}`)
}

export async function fetchReport(project: string, id: string): Promise<FullReport> {
  return jsonFetch(`/api/reports/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`)
}

export async function putReport(
  project: string,
  id: string,
  payload: { content: string; expectedMtime: number; expectedHash: string },
): Promise<{ ok: true; mtime: number; hash: string }> {
  return jsonFetch(`/api/reports/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

// ---------- Digests ----------

export interface FullDigest {
  id: string
  date: string
  path: string
  mtime: number
  hash: string
  content: string
}

export async function fetchDigests(project: string): Promise<{ digests: DigestSummary[] }> {
  return jsonFetch(`/api/digests?project=${encodeURIComponent(project)}`)
}

export async function fetchDigest(project: string, id: string): Promise<FullDigest> {
  return jsonFetch(`/api/digests/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`)
}

export async function putDigest(
  project: string,
  id: string,
  payload: { content: string; expectedMtime: number; expectedHash: string },
): Promise<{ ok: true; mtime: number; hash: string }> {
  return jsonFetch(`/api/digests/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function fetchLog(
  path: string,
  options: { endLine?: number; count?: number } = {},
): Promise<{ totalLines: number; lines: { lineNumber: number; text: string }[] }> {
  const params = new URLSearchParams({ path })
  if (options.endLine !== undefined) params.set('endLine', String(options.endLine))
  if (options.count !== undefined) params.set('count', String(options.count))
  return jsonFetch(`/api/log?${params.toString()}`)
}

export interface LogFileEntry {
  name: string
  path: string
  size: number
  mtime: number
}

export async function fetchLogFiles(expPath: string): Promise<{ files: LogFileEntry[] }> {
  return jsonFetch(`/api/log-files?expPath=${encodeURIComponent(expPath)}`)
}

export async function appendJournalEvent(input: {
  project: string
  tag: string
  body: string
}): Promise<{ appended: { timestamp: string; tag: string; body: string } }> {
  return jsonFetch('/api/journal/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export interface PutReadmeResponse {
  mtime: number
}
export interface PutReadmeConflict {
  error: { code: 'CONFLICT'; message: string }
  mtime: number
  content: string
}

export interface FetchedReadme {
  path: string
  content: string
  mtime: number
  hash: string
}

export async function fetchReadme(path: string): Promise<FetchedReadme> {
  return jsonFetch(`/api/readme?path=${encodeURIComponent(path)}`)
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
}

export async function patchExperimentStatus(input: {
  id: string
  status: string
  expectedMtime: number
  expectedHash?: string
}): Promise<PatchStatusResponse | PutReadmeConflict> {
  const res = await fetch(`/api/runs/${encodeURIComponent(input.id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: input.status,
      expectedMtime: input.expectedMtime,
      expectedHash: input.expectedHash,
    }),
  })
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PatchStatusResponse
}

// ---------- Browser terminal (ttyd + tmux) ----------

export interface TerminalCheckResult {
  available: boolean
  version?: string
  source?: 'cached' | 'path'
  path?: string
  downloadable?: boolean
  suggestion?: string
}

export interface TerminalInstallResult {
  ok: true
  version: string
  path: string
  alreadyPresent?: boolean
  durationMs: number
}

export interface TerminalSession {
  sessionName: string
  port: number
  startedAt: string
  runId: string
  projectName: string
  warnings: string[]
}

export interface TerminalStartResponse {
  sessionName: string
  url: string
  port: number
  startedAt: string
  warnings: string[]
}

export async function checkTerminal(): Promise<TerminalCheckResult> {
  const res = await fetch('/api/terminal/check')
  return jsonOrThrow<TerminalCheckResult>(res)
}

export async function installTerminal(): Promise<TerminalInstallResult> {
  const res = await fetch('/api/terminal/install', { method: 'POST' })
  return jsonOrThrow<TerminalInstallResult>(res)
}

export async function startTerminal(input: {
  runId: string
  projectName: string
}): Promise<TerminalStartResponse> {
  const res = await fetch('/api/terminal/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return jsonOrThrow<TerminalStartResponse>(res)
}

export async function stopTerminal(sessionName: string): Promise<{ stopped: boolean }> {
  const res = await fetch('/api/terminal/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionName }),
  })
  return jsonOrThrow<{ stopped: boolean }>(res)
}

export async function listTerminals(): Promise<{ sessions: TerminalSession[] }> {
  const res = await fetch('/api/terminal/list')
  return jsonOrThrow<{ sessions: TerminalSession[] }>(res)
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json()
  if (!res.ok) {
    const msg =
      (body as { error?: { message?: string } })?.error?.message ??
      `HTTP ${res.status}`
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

export async function fetchWarnings(id: string): Promise<WarningsListResponse> {
  return jsonFetch(`/api/runs/${encodeURIComponent(id)}/warnings`)
}

export async function postWarning(
  id: string,
  input: { category: string; message: string; expectedMtime?: number; expectedHash?: string },
): Promise<WarningsOpResponse | WarningsConflict> {
  const res = await fetch(`/api/runs/${encodeURIComponent(id)}/warnings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await res.json()
  if (res.status === 409) return body as WarningsConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as WarningsOpResponse
}

export async function patchWarningApi(
  id: string,
  rowId: string,
  input: { op: 'resolve' | 'reopen'; note?: string; expectedMtime?: number; expectedHash?: string },
): Promise<WarningsOpResponse | WarningsConflict> {
  const res = await fetch(
    `/api/runs/${encodeURIComponent(id)}/warnings/${encodeURIComponent(rowId)}`,
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
  id: string,
  rowId: string,
  input: { expectedMtime?: number; expectedHash?: string },
): Promise<WarningsOpResponse | WarningsConflict> {
  const res = await fetch(
    `/api/runs/${encodeURIComponent(id)}/warnings/${encodeURIComponent(rowId)}`,
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

// ---------- v3 experiment-doc + anomalies ----------

export interface MemberRunSummary {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  finishedAt: string | null
  host: string | null
  gpus: number[]
  path?: string
  /** The run README's manually-described Artifacts (path + description). */
  artifacts: { path: string; description: string }[]
}

export interface ExperimentDocSummary {
  id: string
  project: string
  path: string
  mtime: number
  frontMatter: {
    id: string
    slug: string
    title: string
    runs: string[]
    hypotheses: string[]
    tags: string[]
    createdAt: string
    updatedAt: string
  }
  sections: {
    motivation: string | null
    method: string | null
    conclusion: string | null
    caveats: string | null
  }
  warningsRaw: string | null
  parseErrors: { message: string }[]
  parseWarnings: { message: string }[]
  effectiveCreatedAt: string
  effectiveUpdatedAt: string
  memberRuns: MemberRunSummary[]
}

export interface ExperimentDocDetail extends Omit<ExperimentDocSummary, 'effectiveCreatedAt' | 'effectiveUpdatedAt'> {}

export interface AnomalyRecord {
  code: 'ORPHAN_RUN' | 'PHANTOM_RUN_REF' | 'MISMATCH_EXPERIMENT_REF'
  project: string
  runId: string | null
  experimentId: string | null
  message: string
  detectedAt: string
}

export async function fetchExperimentDocs(
  project?: string,
): Promise<{ experiments: ExperimentDocSummary[] }> {
  const url = project ? `/api/experiments?project=${encodeURIComponent(project)}` : '/api/experiments'
  return jsonFetch(url)
}

export async function fetchExperimentDoc(id: string): Promise<ExperimentDocDetail> {
  return jsonFetch(`/api/experiments/${encodeURIComponent(id)}`)
}

export async function fetchAnomalies(project?: string): Promise<{ anomalies: AnomalyRecord[] }> {
  const url = project ? `/api/anomalies?project=${encodeURIComponent(project)}` : '/api/anomalies'
  return jsonFetch(url)
}

export interface RunFileTreeNode {
  type: 'file' | 'dir'
  path: string
  size?: number
  mtime?: number
  children?: RunFileTreeNode[]
}

export async function fetchRunFiles(
  id: string,
  depth = 3,
): Promise<{ runId: string; runPath: string; depth: number; truncated: boolean; entries: number; tree: RunFileTreeNode }> {
  return jsonFetch(`/api/runs/${encodeURIComponent(id)}/files?depth=${depth}`)
}

// Re-exports for convenience
export type { Run, Hypothesis, JournalEvent, WarningRecord }
