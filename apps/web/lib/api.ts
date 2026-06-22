// Thin fetch wrappers for the /api/* routes. Used via TanStack Query.
// We `import type` for everything so the @memon/core JS module never enters
// the client bundle (it transitively pulls in fast-glob → fs).

import type {
  CodeReviewSummary,
  CodeReviewFrontMatter,
  CodeReviewCompletion,
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
  /** Hub mode only: the node this project came from (set by the hub's fan-out). */
  node?: string
}

export interface IndexedRun
  extends Pick<Run, 'id' | 'project' | 'path' | 'mtime' | 'readmeMtime' | 'hasReadme' | 'frontMatter' | 'parseErrors' | 'parseWarnings'> {
  stale: boolean
}

export interface FullExperiment
  extends Pick<
    Run,
    'id' | 'project' | 'path' | 'mtime' | 'readmeMtime' | 'hasReadme' | 'frontMatter' | 'sections' | 'body' | 'parseErrors' | 'parseWarnings'
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

export async function fetchCodeReviews(
  project: string,
): Promise<{ codeReviews: CodeReviewSummary[] }> {
  return jsonFetch(`/api/code-reviews?project=${encodeURIComponent(project)}`)
}

export async function fetchCodeReview(project: string, id: string): Promise<FullCodeReview> {
  return jsonFetch(
    `/api/code-reviews/${encodeCodeReviewId(id)}?project=${encodeURIComponent(project)}`,
  )
}

export async function patchCodeReviewProgress(
  project: string,
  id: string,
  patch: CodeReviewProgressPatch,
): Promise<{ ok: true; mtime: number; hash: string; completion: CodeReviewCompletion }> {
  return jsonFetch(
    `/api/code-reviews/${encodeCodeReviewId(id)}?project=${encodeURIComponent(project)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
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

export async function fetchCodePreview(project: string, url: string): Promise<CodePreview> {
  return jsonFetch(
    `/api/code-preview?project=${encodeURIComponent(project)}&url=${encodeURIComponent(url)}`,
  )
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
  path: string
  content: string
  mtime: number
  hash: string
}

export async function fetchReadme(path: string): Promise<FetchedReadme> {
  return jsonFetch(`/api/readme?path=${encodeURIComponent(path)}`)
}

/**
 * Fetch a v3 run README by id. Mirrors `fetchExpDocReadme`: looks up the
 * run dir via the detail endpoint, joins `/README.md`, then reads via
 * the legacy `/api/readme` endpoint. Needed because `Run.path` is the
 * run DIRECTORY (not the README file) — passing the dir to
 * `/api/readme?path=…` triggers `EISDIR` server-side.
 */
export async function fetchRunReadme(id: string): Promise<FetchedReadme> {
  const detail = await jsonFetch<{ path: string; mtime: number }>(
    `/api/runs/${encodeURIComponent(id)}`,
  )
  return fetchReadme(`${detail.path}/README.md`)
}

/**
 * Fetch a v3 experiment doc README by id. Returned shape matches
 * `FetchedReadme` so the editor's load handler stays uniform across modes.
 */
export async function fetchExpDocReadme(id: string): Promise<FetchedReadme> {
  // The exp-doc detail endpoint (`/api/experiments/:id`) returns parsed
  // sections + frontMatter; we want the raw markdown for editing. The
  // simplest server-side route for raw read is GET /api/readme?path=…,
  // and we can derive the absolute path from the detail response. To
  // avoid the round-trip, the GET on /api/experiments/:id/readme could
  // be added later; for now reuse the detail endpoint to learn the path
  // and then GET /api/readme.
  const detail = await jsonFetch<{ path: string; mtime: number }>(
    `/api/experiments/${encodeURIComponent(id)}`,
  )
  return fetchReadme(detail.path)
}

export async function putExpDocReadme(input: {
  id: string
  content: string
  expectedMtime: number
  expectedHash?: string
}): Promise<PutReadmeResponse | PutReadmeConflict> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(input.id)}/readme`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: input.content,
      expectedMtime: input.expectedMtime,
      expectedHash: input.expectedHash,
    }),
  })
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PutReadmeResponse
}

export async function putRunReadme(input: {
  id: string
  content: string
  expectedMtime: number
  expectedHash?: string
}): Promise<PutReadmeResponse | PutReadmeConflict> {
  const res = await fetch(`/api/runs/${encodeURIComponent(input.id)}/readme`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: input.content,
      expectedMtime: input.expectedMtime,
      expectedHash: input.expectedHash,
    }),
  })
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
  id: string
  status: string
  expectedMtime: number
  expectedHash?: string
}): Promise<PatchStatusResponse | PutReadmeConflict | PatchStatusForbidden> {
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
  id: string
  archived: boolean
  expectedMtime?: number
}): Promise<PatchArchiveResponse | PatchArchiveForbidden | PutReadmeConflict> {
  const res = await fetch(`/api/runs/${encodeURIComponent(input.id)}/archive`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: input.archived, expectedMtime: input.expectedMtime }),
  })
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
  id: string
  status: 'OPEN' | 'RESOLVED' | 'ABANDONED'
  expectedMtime: number
}): Promise<PatchExperimentStatusResponse | PutReadmeConflict> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(input.id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: input.status, expectedMtime: input.expectedMtime }),
  })
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PatchExperimentStatusResponse
}

export async function patchExperimentArchived(input: {
  id: string
  archived: boolean
  expectedMtime?: number
}): Promise<PatchArchiveResponse | PutReadmeConflict> {
  const res = await fetch(`/api/experiments/${encodeURIComponent(input.id)}/archive`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: input.archived, expectedMtime: input.expectedMtime }),
  })
  const body = await res.json()
  if (res.status === 409) return body as PutReadmeConflict
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`)
  return body as PatchArchiveResponse
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

export type TerminalAgentKind = 'none' | 'claude' | 'codex' | 'opencode'
export type TerminalScopeKind = 'exp' | 'run' | 'project'

/** Slug carried in `(scope: 'project')` calls. Project scope has no
 *  per-target slug — the project name itself disambiguates — but the
 *  session-name format reserves a slug segment, so we use this sentinel.
 *  Render: `memon-<agent>-<project>--project--root`. */
export const PROJECT_SCOPE_SLUG = 'root' as const

export interface TerminalSession {
  sessionName: string
  port: number
  startedAt: string
  lastActiveAt: string
  agent: TerminalAgentKind
  project: string
  scope: TerminalScopeKind
  slug: string
  warnings: string[]
}

export interface TerminalStartResponse {
  sessionName: string
  url: string
  port: number
  startedAt: string
  warnings: string[]
}

/**
 * Active-pane info sourced from `tmux list-panes -a`. All fields are
 * possibly null — `pane: null` (parent-level) means tmux didn't surface
 * a usable active pane; individual nulls mean tmux returned an empty
 * string for that field.
 */
export interface TmuxPaneInfo {
  /** OSC-set PTY window title from the foreground program. Truncated to ≤257 chars. */
  title: string | null
  /** Basename of the foreground process (e.g. `claude`, `bash`, `node`). */
  currentCommand: string | null
  /** Absolute cwd of the foreground process. */
  currentPath: string | null
}

/**
 * Card-footer liveness state derived server-side from `pane.title` plus the
 * unacknowledged-running memo. See `apps/web/lib/terminal/pane-state.ts`.
 */
export type TmuxPaneState = 'idle' | 'running' | 'attention' | 'done'

export interface TmuxSessionRow {
  sessionName: string
  parsed: {
    raw: string
    agent: TerminalAgentKind | null
    project: string | null
    scope: TerminalScopeKind | null
    slug: string | null
    legacy: boolean
  }
  liveEntry: { port: number; lastActiveAt: string } | null
  tmuxCreatedAt: string
  tmuxLastActivity: string
  matchable: boolean
  /**
   * Stale = parses to the standard `memon-<agent>-<project>--<scope>--<slug>`
   * format AND the project / target lookup failed. Manual rows (legacy or
   * arbitrary names like `memon-manual-foo`) have `staleReason: null` AND
   * `matchable: false` — they are not stale, just not addressable as a
   * standard project/run/exp target.
   */
  staleReason: 'unknown-project' | 'unknown-target' | null
  /** Pane info from `tmux list-panes -a`; null when tmux didn't surface a usable active pane. */
  pane: TmuxPaneInfo | null
  /** Liveness state derived server-side from pane.title plus an
   *  unacknowledged-running memo. Drives the card footer's bg tint. */
  state: TmuxPaneState
  /** ISO8601 of the most recent server-observed state transition for this
   *  sessionName, or `null` when none has been observed since the memo
   *  was last reset (fresh first-seen row, or right after the user
   *  opened the ttyd). The card displays
   *  `max(lastStateChangeAt, tmuxLastActivity)` as the relative time. */
  lastStateChangeAt: string | null
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
  project: string
  scope: TerminalScopeKind
  slug: string
  agent?: TerminalAgentKind
}): Promise<TerminalStartResponse> {
  const res = await fetch('/api/terminal/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return jsonOrThrow<TerminalStartResponse>(res)
}

/**
 * Raw-attach by sessionName. Used by /manage/tmux's manual-row Drawer
 * and Popup buttons where the session name doesn't parse to the standard
 * `memon-<agent>-<project>--<scope>--<slug>` format.
 */
export async function attachTerminal(input: {
  sessionName: string
}): Promise<TerminalStartResponse> {
  const res = await fetch('/api/terminal/attach', {
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

export async function listTmuxSessions(): Promise<{ sessions: TmuxSessionRow[] }> {
  const res = await fetch('/api/tmux-sessions')
  return jsonOrThrow<{ sessions: TmuxSessionRow[] }>(res)
}

/**
 * Enriched single-row lookup. Returns the same row shape as
 * `listTmuxSessions().sessions[i]`. Used by per-target indicators that
 * only need to know about one session without polling the whole inventory.
 */
export async function getTmuxSession(name: string): Promise<{ row: TmuxSessionRow }> {
  const res = await fetch(`/api/tmux-sessions/${encodeURIComponent(name)}`)
  return jsonOrThrow<{ row: TmuxSessionRow }>(res)
}

export async function killTmuxSession(name: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/tmux-sessions/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  return jsonOrThrow<{ ok: true }>(res)
}

export async function createTmuxSession(input: {
  name: string
}): Promise<{ ok: true; sessionName: string; alreadyExisted: boolean }> {
  const res = await fetch('/api/tmux-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return jsonOrThrow<{ ok: true; sessionName: string; alreadyExisted: boolean }>(res)
}

export async function renameTmuxSession(input: {
  name: string
  newName: string
}): Promise<{ ok: true; sessionName: string }> {
  const res = await fetch(
    `/api/tmux-sessions/${encodeURIComponent(input.name)}/rename`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName: input.newName }),
    },
  )
  return jsonOrThrow<{ ok: true; sessionName: string }>(res)
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
  /** v4-added — true when the run README's `archived` frontmatter is true. */
  archived?: boolean
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
  memberRuns: MemberRunSummary[]
}

/**
 * v3 detail (`/api/experiments/:id`). Mirrors the summary plus a per-run
 * artifact aggregate. As of Slice δ (task 5.4) the detail endpoint also
 * returns `effectiveCreatedAt` / `effectiveUpdatedAt` so this type now
 * extends the summary directly.
 */
export interface ExperimentDocDetail extends ExperimentDocSummary {}

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
  throw new ApiError(
    res.status,
    (body as { error?: { message?: string } })?.error?.message ?? text,
  )
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

export async function fetchGitStatus(project: string): Promise<GitStatus> {
  return jsonFetch(`/api/projects/${encodeURIComponent(project)}/git-status`)
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
  project: string,
  submodule?: string,
): Promise<GitStatusFiles> {
  const params = new URLSearchParams()
  if (submodule) params.set('submodule', submodule)
  const qs = params.toString()
  return jsonFetch(
    `/api/projects/${encodeURIComponent(project)}/git-status/files${qs ? `?${qs}` : ''}`,
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
  project: string,
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
    `/api/projects/${encodeURIComponent(project)}/git-diff?${params.toString()}`,
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
  project: string,
  from: string,
  to: string,
  submodule?: string,
): Promise<GitRangeResponse> {
  const params = new URLSearchParams({ from, to })
  if (submodule) params.set('submodule', submodule)
  return jsonFetch(
    `/api/projects/${encodeURIComponent(project)}/git-range?${params.toString()}`,
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
  project: string,
  submodule?: string,
): Promise<GitBranches> {
  const params = new URLSearchParams()
  if (submodule) params.set('submodule', submodule)
  const qs = params.toString()
  return jsonFetch(
    `/api/projects/${encodeURIComponent(project)}/git-branches${qs ? `?${qs}` : ''}`,
  )
}

export async function fetchGitLog(
  project: string,
  ref: string,
  limit?: number,
  submodule?: string,
): Promise<GitLog> {
  const params = new URLSearchParams({ ref })
  if (limit !== undefined) params.set('limit', String(limit))
  if (submodule) params.set('submodule', submodule)
  return jsonFetch(
    `/api/projects/${encodeURIComponent(project)}/git-log?${params.toString()}`,
  )
}

export async function fetchGitCommit(
  project: string,
  sha: string,
  submodule?: string,
): Promise<GitCommitDetail> {
  const params = new URLSearchParams({ sha })
  if (submodule) params.set('submodule', submodule)
  return jsonFetch(
    `/api/projects/${encodeURIComponent(project)}/git-commit?${params.toString()}`,
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

export async function fetchSubmodules(project: string): Promise<GitSubmodules> {
  return jsonFetch(`/api/projects/${encodeURIComponent(project)}/submodules`)
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

export async function fetchCommitMarks(
  project: string,
): Promise<CommitMarksResponse> {
  return jsonFetch(
    `/api/projects/${encodeURIComponent(project)}/commit-marks`,
  )
}

function commitMarkUrl(project: string, sha: string, submodule?: string): string {
  const base = `/api/projects/${encodeURIComponent(project)}/commit-marks/${encodeURIComponent(sha)}`
  if (!submodule) return base
  return `${base}?submodule=${encodeURIComponent(submodule)}`
}

export async function setCommitMark(
  project: string,
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
  project: string,
  sha: string,
  submodule?: string,
): Promise<{ deleted: boolean }> {
  return jsonFetch(commitMarkUrl(project, sha, submodule), { method: 'DELETE' })
}

// Re-exports for convenience
export type { Run, Hypothesis, JournalEvent, WarningRecord }
