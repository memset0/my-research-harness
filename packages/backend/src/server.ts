import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { TextDecoder } from 'node:util'
import {
  AmbiguousShareError,
  BACKEND_API_MAJOR,
  BACKEND_TERMINAL_PUBLIC_PATH_HEADER,
  BackendAnomaliesResponseSchema,
  BackendArchiveMutationRequestSchema,
  type BackendCapabilities,
  BackendCapabilitiesSchema,
  BackendCodePreviewResponseSchema,
  BackendCodeReviewPatchRequestSchema,
  BackendCodeReviewPatchResponseSchema,
  BackendCodeReviewResponseSchema,
  BackendCodeReviewsResponseSchema,
  BackendCommitMarkDeleteResponseSchema,
  BackendCommitMarksResponseSchema,
  BackendCommitMarkWriteRequestSchema,
  BackendCommitMarkWriteResponseSchema,
  BackendDigestResponseSchema,
  BackendDigestsResponseSchema,
  BackendDocumentConflictResponseSchema,
  BackendDocumentWriteRequestSchema,
  BackendDocumentWriteResponseSchema,
  type BackendErrorCode,
  BackendErrorResponseSchema,
  BackendExperimentBindRequestSchema,
  BackendExperimentBindResponseSchema,
  BackendExperimentCreateRequestSchema,
  BackendExperimentCreateResponseSchema,
  BackendExperimentDeleteRequestSchema,
  BackendExperimentDeleteResponseSchema,
  BackendExperimentResponseSchema,
  BackendExperimentResultsResponseSchema,
  BackendExperimentsResponseSchema,
  BackendGitBranchesResponseSchema,
  BackendGitCommitResponseSchema,
  BackendGitDiffResponseSchema,
  BackendGitLogResponseSchema,
  BackendGitRangeResponseSchema,
  BackendGitRefSchema,
  BackendGitStatusFilesResponseSchema,
  BackendGitStatusResponseSchema,
  BackendGitSubmodulesResponseSchema,
  BackendHerdrStartRequestSchema,
  BackendHypothesesResponseSchema,
  BackendJournalAppendRequestSchema,
  BackendJournalAppendResponseSchema,
  BackendJournalCountResponseSchema,
  BackendJournalResponseSchema,
  BackendLogFilesResponseSchema,
  BackendLogLinesResponseSchema,
  BackendLogStreamEventSchema,
  BackendMetadataSchema,
  BackendMutationResponseSchema,
  BackendProjectDiscoverySchema,
  BackendProjectsResponseSchema,
  BackendReadmeMutationResponseSchema,
  BackendReadmeResponseSchema,
  BackendReportResponseSchema,
  BackendReportsResponseSchema,
  BackendRunFilesResponseSchema,
  BackendRunResponseSchema,
  BackendRunsResponseSchema,
  type BackendServiceTokens,
  BackendShareCreateRequestSchema,
  BackendShareCreateResponseSchema,
  BackendShareListResponseSchema,
  BackendShareRevokeResponseSchema,
  BackendShareValidationRequestSchema,
  BackendShareValidationResponseSchema,
  BackendSlurmStatusSchema,
  BackendStatusMutationRequestSchema,
  BackendTerminalAttachRequestSchema,
  BackendTerminalCheckResponseSchema,
  BackendTerminalInstallResponseSchema,
  BackendTerminalListResponseSchema,
  BackendTerminalStartRequestSchema,
  BackendTerminalStartResponseSchema,
  BackendTerminalStopRequestSchema,
  BackendTerminalStopResponseSchema,
  BackendTmuxCreateRequestSchema,
  BackendTmuxCreateResponseSchema,
  BackendTmuxKillResponseSchema,
  BackendTmuxRenameRequestSchema,
  BackendTmuxRenameResponseSchema,
  BackendTmuxSessionResponseSchema,
  BackendTmuxSessionsResponseSchema,
  BackendWarningMutationRequestSchema,
  BackendWarningMutationResponseSchema,
  BackendWarningsResponseSchema,
  BackendWikiBacklinksResponseSchema,
  BackendWikiConflictResponseSchema,
  BackendWikiDocumentSchema,
  BackendWikiPagesResponseSchema,
  BackendWikiReviewMarkRequestSchema,
  BackendWikiReviewOrderResponseSchema,
  BackendWikiReviewResponseSchema,
  BackendWikiWriteResponseSchema,
  HostIdSchema,
  InstanceEpochSchema,
  MEMON_RELEASE,
  MEMON_REVISION,
  ProjectNameSchema,
  ReleaseVersionSchema,
  ResourceIdSchema,
  RevisionSchema,
  ShareNotFoundError,
  TerminalSessionIdSchema,
  WikiReviewError,
  WikiReviewOrderError,
} from '@memon/core'
import { createProxyServer } from 'http-proxy-3'
import {
  authorizeBackendActor,
  BACKEND_ACTOR_CONTEXT_HEADER,
  BackendActorContextError,
  decodeBackendActorContext,
} from './actor-context.js'
import { type BackendDocumentService, BackendDocumentServiceError } from './document-service.js'
import { BackendEventStream } from './event-stream.js'
import type { BackendFilesystemMonitorControl } from './filesystem-monitor.js'
import { type BackendGitService, BackendGitServiceError } from './git-service.js'
import { BackendMutationError, type BackendMutationService } from './mutation-service.js'
import { type BackendProjectReadService, BackendProjectServiceError } from './project-service.js'
import type { BackendSlurmService } from './slurm-service.js'
import {
  type BackendByteResource,
  type BackendStreamService,
  BackendStreamServiceError,
} from './stream-service.js'
import { type BackendTerminalService, BackendTerminalServiceError } from './terminal-service.js'

export const BACKEND_API_PREFIX = '/api/backend/v1'
export const BACKEND_META_PATH = `${BACKEND_API_PREFIX}/meta`
export const BACKEND_EVENTS_PATH = `${BACKEND_API_PREFIX}/events`
export const BACKEND_PROJECTS_PATH = `${BACKEND_API_PREFIX}/projects`
export const BACKEND_TERMINAL_PROXY_PREFIX = `${BACKEND_API_PREFIX}/terminal/proxy/`
export const BACKEND_TERMINAL_CHECK_ROUTE = `${BACKEND_API_PREFIX}/terminal/check`
export const BACKEND_TERMINAL_INSTALL_ROUTE = `${BACKEND_API_PREFIX}/terminal/install`
export const BACKEND_TERMINAL_START_ROUTE = `${BACKEND_API_PREFIX}/terminal/start`
export const BACKEND_TERMINAL_ATTACH_ROUTE = `${BACKEND_API_PREFIX}/terminal/attach`
export const BACKEND_TERMINAL_LIST_ROUTE = `${BACKEND_API_PREFIX}/terminal/list`
export const BACKEND_TERMINAL_STOP_ROUTE = `${BACKEND_API_PREFIX}/terminal/stop`
export const BACKEND_TERMINAL_HERDR_ROUTE = `${BACKEND_API_PREFIX}/terminal/herdr`
export const BACKEND_TMUX_SESSIONS_ROUTE = `${BACKEND_API_PREFIX}/tmux-sessions`
export const BACKEND_TMUX_SESSION_ROUTE = `${BACKEND_API_PREFIX}/tmux-sessions/[name]`
export const BACKEND_TMUX_RENAME_ROUTE = `${BACKEND_API_PREFIX}/tmux-sessions/[name]/rename`
const CENTRAL_TERMINAL_PROXY_PREFIX = '/api/terminal/proxy/'
export const BACKEND_SHARE_VALIDATE_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/shares/validate`
export const BACKEND_SHARES_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/shares`
export const BACKEND_SHARE_ITEM_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/shares/[id]`
export const BACKEND_RUNS_ROUTE = `${BACKEND_API_PREFIX}/runs`
export const BACKEND_RUN_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]`
export const BACKEND_EXPERIMENTS_ROUTE = `${BACKEND_API_PREFIX}/experiments`
export const BACKEND_EXPERIMENT_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]`
export const BACKEND_HYPOTHESES_ROUTE = `${BACKEND_API_PREFIX}/hypotheses`
export const BACKEND_JOURNAL_ROUTE = `${BACKEND_API_PREFIX}/journal`
export const BACKEND_ANOMALIES_ROUTE = `${BACKEND_API_PREFIX}/anomalies`
export const BACKEND_REPORTS_ROUTE = `${BACKEND_API_PREFIX}/reports`
export const BACKEND_REPORT_ROUTE = `${BACKEND_API_PREFIX}/reports/[id]`
export const BACKEND_DIGESTS_ROUTE = `${BACKEND_API_PREFIX}/digests`
export const BACKEND_DIGEST_ROUTE = `${BACKEND_API_PREFIX}/digests/[id]`
export const BACKEND_CODE_REVIEWS_ROUTE = `${BACKEND_API_PREFIX}/code-reviews`
export const BACKEND_CODE_REVIEW_ROUTE = `${BACKEND_API_PREFIX}/code-reviews/[...id]`
export const BACKEND_README_ROUTE = `${BACKEND_API_PREFIX}/readme`
export const BACKEND_RUN_README_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/readme`
export const BACKEND_EXPERIMENT_README_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/readme`
export const BACKEND_RUN_FILES_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/files`
export const BACKEND_EXPERIMENT_RESULTS_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/results`
export const BACKEND_GIT_STATUS_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-status`
export const BACKEND_GIT_STATUS_FILES_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-status/files`
export const BACKEND_GIT_BRANCHES_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-branches`
export const BACKEND_GIT_LOG_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-log`
export const BACKEND_GIT_COMMIT_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-commit`
export const BACKEND_GIT_RANGE_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-range`
export const BACKEND_GIT_DIFF_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/git-diff`
export const BACKEND_GIT_SUBMODULES_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/submodules`
export const BACKEND_GIT_COMMIT_MARKS_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/commit-marks`
export const BACKEND_GIT_COMMIT_MARK_ROUTE = `${BACKEND_API_PREFIX}/projects/[project]/commit-marks/[sha]`
export const BACKEND_CODE_PREVIEW_ROUTE = `${BACKEND_API_PREFIX}/code-preview`
export const BACKEND_SLURM_STATUS_ROUTE = `${BACKEND_API_PREFIX}/slurm/status`
export const BACKEND_RUN_STATUS_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/status`
export const BACKEND_RUN_ARCHIVE_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/archive`
export const BACKEND_EXPERIMENT_STATUS_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/status`
export const BACKEND_EXPERIMENT_ARCHIVE_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/archive`
export const BACKEND_JOURNAL_APPEND_ROUTE = `${BACKEND_API_PREFIX}/journal/append`
export const BACKEND_RUN_WARNINGS_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/warnings`
export const BACKEND_RUN_WARNING_ROUTE = `${BACKEND_API_PREFIX}/runs/[id]/warnings/[rowId]`
export const BACKEND_EXPERIMENT_WARNINGS_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/warnings`
export const BACKEND_EXPERIMENT_WARNING_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/warnings/[rowId]`
export const BACKEND_EXPERIMENT_LINK_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/link`
export const BACKEND_EXPERIMENT_UNLINK_ROUTE = `${BACKEND_API_PREFIX}/experiments/[id]/unlink`
export const BACKEND_LOG_FILES_ROUTE = `${BACKEND_API_PREFIX}/log-files`
export const BACKEND_LOG_ROUTE = `${BACKEND_API_PREFIX}/log`
export const BACKEND_LOG_STREAM_ROUTE = `${BACKEND_API_PREFIX}/log/stream`
export const BACKEND_REPORT_ASSET_ROUTE = `${BACKEND_API_PREFIX}/report-assets/[project]/[id]/[...path]`
export const BACKEND_WIKI_ROUTE = `${BACKEND_API_PREFIX}/wiki`
export const BACKEND_WIKI_PAGE_ROUTE = `${BACKEND_API_PREFIX}/wiki/[id]`
export const BACKEND_WIKI_BACKLINKS_ROUTE = `${BACKEND_API_PREFIX}/wiki/backlinks/[artifact]`
export const BACKEND_WIKI_REVIEW_ROUTE = `${BACKEND_API_PREFIX}/wiki/review`
export const BACKEND_WIKI_REVIEW_MARK_ROUTE = `${BACKEND_API_PREFIX}/wiki/review/[sha]`
export const BACKEND_WIKI_ASSET_ROUTE = `${BACKEND_API_PREFIX}/wiki-assets/[project]/[id]/[...path]`
export const BACKEND_ROUTE_ALLOW_LIST = Object.freeze({
  [BACKEND_META_PATH]: Object.freeze(['GET'] as const),
  [BACKEND_EVENTS_PATH]: Object.freeze(['GET'] as const),
  [BACKEND_PROJECTS_PATH]: Object.freeze(['GET'] as const),
  [BACKEND_TERMINAL_CHECK_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_TERMINAL_INSTALL_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_TERMINAL_START_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_TERMINAL_ATTACH_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_TERMINAL_LIST_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_TERMINAL_STOP_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_TERMINAL_HERDR_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_TMUX_SESSIONS_ROUTE]: Object.freeze(['GET', 'POST'] as const),
  [BACKEND_TMUX_SESSION_ROUTE]: Object.freeze(['GET', 'DELETE'] as const),
  [BACKEND_TMUX_RENAME_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_SHARE_VALIDATE_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_SHARES_ROUTE]: Object.freeze(['GET', 'POST'] as const),
  [BACKEND_SHARE_ITEM_ROUTE]: Object.freeze(['DELETE'] as const),
  [BACKEND_RUNS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_RUN_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_EXPERIMENTS_ROUTE]: Object.freeze(['GET', 'POST'] as const),
  [BACKEND_EXPERIMENT_ROUTE]: Object.freeze(['GET', 'DELETE'] as const),
  [BACKEND_HYPOTHESES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_JOURNAL_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_ANOMALIES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_REPORTS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_REPORT_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_DIGESTS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_DIGEST_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_CODE_REVIEWS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_CODE_REVIEW_ROUTE]: Object.freeze(['GET', 'PATCH'] as const),
  [BACKEND_README_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_RUN_README_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_EXPERIMENT_README_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_RUN_FILES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_EXPERIMENT_RESULTS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_STATUS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_STATUS_FILES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_BRANCHES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_LOG_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_COMMIT_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_RANGE_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_DIFF_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_SUBMODULES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_COMMIT_MARKS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_GIT_COMMIT_MARK_ROUTE]: Object.freeze(['PUT', 'DELETE'] as const),
  [BACKEND_CODE_PREVIEW_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_SLURM_STATUS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_RUN_STATUS_ROUTE]: Object.freeze(['PATCH'] as const),
  [BACKEND_RUN_ARCHIVE_ROUTE]: Object.freeze(['PATCH'] as const),
  [BACKEND_EXPERIMENT_STATUS_ROUTE]: Object.freeze(['PATCH'] as const),
  [BACKEND_EXPERIMENT_ARCHIVE_ROUTE]: Object.freeze(['PATCH'] as const),
  [BACKEND_JOURNAL_APPEND_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_RUN_WARNINGS_ROUTE]: Object.freeze(['GET', 'POST'] as const),
  [BACKEND_RUN_WARNING_ROUTE]: Object.freeze(['PATCH', 'DELETE'] as const),
  [BACKEND_EXPERIMENT_WARNINGS_ROUTE]: Object.freeze(['GET', 'POST'] as const),
  [BACKEND_EXPERIMENT_WARNING_ROUTE]: Object.freeze(['PATCH', 'DELETE'] as const),
  [BACKEND_EXPERIMENT_LINK_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_EXPERIMENT_UNLINK_ROUTE]: Object.freeze(['POST'] as const),
  [BACKEND_LOG_FILES_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_LOG_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_LOG_STREAM_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_REPORT_ASSET_ROUTE]: Object.freeze(['GET', 'HEAD'] as const),
  [BACKEND_WIKI_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_WIKI_PAGE_ROUTE]: Object.freeze(['GET', 'PUT'] as const),
  [BACKEND_WIKI_BACKLINKS_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_WIKI_REVIEW_ROUTE]: Object.freeze(['GET'] as const),
  [BACKEND_WIKI_REVIEW_MARK_ROUTE]: Object.freeze(['POST', 'DELETE'] as const),
  [BACKEND_WIKI_ASSET_ROUTE]: Object.freeze(['GET', 'HEAD'] as const),
})
export const MAX_BACKEND_CONTROL_JSON_BYTES = 1024 * 1024
export const MAX_BACKEND_DOCUMENT_BODY_BYTES = 5 * 1024 * 1024
export const MAX_BACKEND_GIT_CONTROL_BODY_BYTES = 128 * 1024
export const MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES = 4 * 1024
const MAX_AUTHORIZATION_BYTES = 4096
const MIN_SERVICE_TOKEN_CHARS = 32
const SERVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/
const DUMMY_SERVICE_TOKEN = '00000000000000000000000000000000'
const DEFAULT_BACKEND_STREAM_CONTROL_DEADLINE_MS = 10_000

export type BackendServiceTokenSet = BackendServiceTokens

export type ReadinessProvider = () => boolean | Promise<boolean>
export interface ProjectDiscoveryItem {
  name: string
  label?: string
  description?: string
}
export type ProjectDiscoveryProvider = () =>
  | readonly ProjectDiscoveryItem[]
  | Promise<readonly ProjectDiscoveryItem[]>
export type BackendShareValidator = (project: string, token: string) => boolean | Promise<boolean>
export type BackendTerminalTargetResolver = (
  opaqueRoute: string,
) => string | null | Promise<string | null>
export interface BackendShareProviders {
  list: (project: string, includeTokens: boolean) => unknown | Promise<unknown>
  add: (project: string, input: { label?: string; expires?: string }) => unknown | Promise<unknown>
  revoke: (project: string, id: string) => unknown | Promise<unknown>
}

export interface BackendServerOptions {
  hostId: string
  serviceTokens: BackendServiceTokenSet
  capabilities: BackendCapabilities
  readOnly?: boolean
  release?: string
  revision?: string
  instanceEpoch?: string
  readiness?: boolean | ReadinessProvider
  eventStream?: BackendEventStream
  projectDiscovery?: ProjectDiscoveryProvider
  shareValidator?: BackendShareValidator
  shareProviders?: Partial<BackendShareProviders>
  terminalTargetResolver?: BackendTerminalTargetResolver
  terminalService?: BackendTerminalService
  onTerminalProxyError?: (error: Error) => void
  projectService?: BackendProjectReadService
  documentService?: BackendDocumentService
  gitService?: BackendGitService
  slurmService?: BackendSlurmService | null
  mutationService?: BackendMutationService
  streamService?: BackendStreamService
  streamControlDeadlineMs?: number
  filesystemMonitor?: BackendFilesystemMonitorControl
}

export type BackendHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

interface ResolvedBackendOptions {
  host: ReturnType<typeof HostIdSchema.parse>
  serviceTokens: Readonly<BackendServiceTokenSet>
  capabilities: BackendCapabilities
  readOnly: boolean
  release: ReturnType<typeof ReleaseVersionSchema.parse>
  revision: ReturnType<typeof RevisionSchema.parse>
  instanceEpoch: ReturnType<typeof InstanceEpochSchema.parse>
  readiness: ReadinessProvider
  eventStream: BackendEventStream
  projectDiscovery: ProjectDiscoveryProvider
  shareValidator: BackendShareValidator
  shareProviders: BackendShareProviders
  terminalTargetResolver: BackendTerminalTargetResolver | null
  terminalService?: BackendTerminalService
  onTerminalProxyError: ((error: Error) => void) | undefined
  projectService?: BackendProjectReadService
  documentService?: BackendDocumentService
  gitService?: BackendGitService
  slurmService: BackendSlurmService | null
  mutationService?: BackendMutationService
  streamService?: BackendStreamService
  streamControlDeadlineMs: number
  filesystemMonitor?: BackendFilesystemMonitorControl
}

function validateServiceToken(token: string, label: string): string {
  if (token.length < MIN_SERVICE_TOKEN_CHARS || !SERVICE_TOKEN_PATTERN.test(token)) {
    throw new Error(`${label} must contain at least 32 base64url characters`)
  }
  return token
}

function resolveOptions(options: BackendServerOptions): ResolvedBackendOptions {
  const current = validateServiceToken(options.serviceTokens.current, 'serviceTokens.current')
  const next = options.serviceTokens.next
    ? validateServiceToken(options.serviceTokens.next, 'serviceTokens.next')
    : undefined
  if (next === current) {
    throw new Error('serviceTokens.next must differ from serviceTokens.current')
  }

  const readinessOption = options.readiness
  const readiness =
    typeof readinessOption === 'function' ? readinessOption : async () => readinessOption ?? true
  const instanceEpoch = InstanceEpochSchema.parse(options.instanceEpoch ?? randomUUID())
  const eventStream = options.eventStream ?? new BackendEventStream({ instanceEpoch })
  if (eventStream.instanceEpoch !== instanceEpoch) {
    throw new Error('eventStream instance epoch must match Backend metadata instance epoch')
  }
  const streamControlDeadlineMs =
    options.streamControlDeadlineMs ?? DEFAULT_BACKEND_STREAM_CONTROL_DEADLINE_MS
  if (
    !Number.isSafeInteger(streamControlDeadlineMs) ||
    streamControlDeadlineMs < 10 ||
    streamControlDeadlineMs > 60_000
  ) {
    throw new Error('streamControlDeadlineMs must be an integer between 10 and 60000')
  }

  return {
    host: HostIdSchema.parse(options.hostId),
    serviceTokens: Object.freeze({ current, ...(next ? { next } : {}) }),
    capabilities: BackendCapabilitiesSchema.parse(
      options.readOnly
        ? {
            ...options.capabilities,
            mutations: false,
            tmux: false,
            terminal: false,
            slurm: false,
            herdr: false,
          }
        : options.capabilities,
    ),
    readOnly: options.readOnly ?? false,
    release: ReleaseVersionSchema.parse(options.release ?? MEMON_RELEASE),
    revision: RevisionSchema.parse(options.revision ?? MEMON_REVISION),
    instanceEpoch,
    readiness,
    eventStream,
    projectDiscovery: options.projectDiscovery ?? (() => []),
    shareValidator: options.shareValidator ?? (() => false),
    shareProviders: {
      list: options.shareProviders?.list ?? (() => []),
      add:
        options.shareProviders?.add ??
        (() => {
          throw new Error('share add provider is unavailable')
        }),
      revoke:
        options.shareProviders?.revoke ??
        (() => {
          throw new Error('share revoke provider is unavailable')
        }),
    },
    terminalTargetResolver:
      options.terminalTargetResolver ??
      (options.terminalService ? (route) => options.terminalService!.target(route) : null),
    terminalService: options.terminalService,
    onTerminalProxyError: options.onTerminalProxyError,
    projectService: options.projectService,
    documentService: options.documentService,
    gitService: options.gitService,
    slurmService: options.slurmService ?? null,
    mutationService: options.mutationService,
    streamService: options.streamService,
    streamControlDeadlineMs,
    filesystemMonitor: options.filesystemMonitor,
  }
}

function constantTimeStringEqual(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  const compareLength = Math.max(candidateBytes.length, expectedBytes.length, 1)
  const paddedCandidate = Buffer.alloc(compareLength)
  const paddedExpected = Buffer.alloc(compareLength)
  candidateBytes.copy(paddedCandidate)
  expectedBytes.copy(paddedExpected)
  return (
    timingSafeEqual(paddedCandidate, paddedExpected) &&
    candidateBytes.length === expectedBytes.length
  )
}

function bearerToken(request: IncomingMessage): string | null {
  // Backend service auth is deliberately not a browser auth surface. Even a
  // valid Bearer token cannot be combined with browser or proxy credentials.
  if (
    request.headers.cookie !== undefined ||
    request.headers['proxy-authorization'] !== undefined
  ) {
    return null
  }

  const authorization = request.headers.authorization
  if (
    typeof authorization !== 'string' ||
    Buffer.byteLength(authorization) > MAX_AUTHORIZATION_BYTES
  ) {
    return null
  }
  const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization)
  return match?.[1] ?? null
}

function authenticates(request: IncomingMessage, tokens: BackendServiceTokenSet): boolean {
  const candidate = bearerToken(request) ?? ''
  let matched = 0
  for (const [configured, active] of [
    [tokens.current, true],
    [tokens.next ?? DUMMY_SERVICE_TOKEN, tokens.next !== undefined],
  ] as const) {
    // Do not early-return: both rotation slots are compared for every request.
    const equal = constantTimeStringEqual(candidate, configured)
    matched |= Number(active) & Number(equal)
  }
  return matched !== 0
}

function endJson(response: ServerResponse, status: number, payload: string): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(payload)
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  maxBytes = MAX_BACKEND_CONTROL_JSON_BYTES,
): void {
  const payload = JSON.stringify(body)
  if (Buffer.byteLength(payload) > maxBytes) {
    const boundedError = JSON.stringify(
      BackendErrorResponseSchema.parse({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Backend control response exceeds the size limit',
          retryable: false,
        },
      }),
    )
    endJson(response, 500, boundedError)
    return
  }
  endJson(response, status, payload)
}

function writeError(
  response: ServerResponse,
  status: number,
  code: BackendErrorCode,
  message: string,
  retryable = false,
): void {
  writeJson(
    response,
    status,
    BackendErrorResponseSchema.parse({ error: { code, message, retryable } }),
  )
}

function writeDocumentResult(response: ServerResponse, result: unknown): boolean {
  const conflict = BackendDocumentConflictResponseSchema.safeParse(result)
  if (conflict.success) {
    writeJson(response, 409, conflict.data)
    return false
  }
  writeJson(response, 200, BackendDocumentWriteResponseSchema.parse(result))
  return true
}

function writeCodeReviewResult(response: ServerResponse, result: unknown): boolean {
  const conflict = BackendDocumentConflictResponseSchema.safeParse(result)
  if (conflict.success) {
    writeJson(response, 409, conflict.data)
    return false
  }
  writeJson(response, 200, BackendCodeReviewPatchResponseSchema.parse(result))
  return true
}

function publishJournalChange(eventStream: BackendEventStream, project: string): void {
  eventStream.publish({ project, topic: 'journal-change', data: { type: 'append' } })
}

function mutationErrorStatus(error: BackendMutationError): 400 | 403 | 404 | 409 | 500 {
  switch (error.code) {
    case 'BAD_STATE':
      return 409
    case 'BAD_REQUEST':
      return 400
    case 'FORBIDDEN':
      return 403
    case 'PROJECT_NOT_FOUND':
    case 'RESOURCE_NOT_FOUND':
      return 404
    default:
      return 500
  }
}

function isBackendNamespacePath(pathname: string): boolean {
  return pathname === BACKEND_API_PREFIX || pathname.startsWith(`${BACKEND_API_PREFIX}/`)
}

function rawOriginFormPath(requestTarget: string): string | null {
  if (!requestTarget.startsWith('/')) return null
  const end = requestTarget.search(/[?#]/)
  return end === -1 ? requestTarget : requestTarget.slice(0, end)
}

interface AllowedBackendRoute {
  key: keyof typeof BACKEND_ROUTE_ALLOW_LIST
  methods: readonly string[]
  project?: ReturnType<typeof ProjectNameSchema.parse>
  shareId?: string
  resourceId?: ReturnType<typeof ResourceIdSchema.parse>
  gitRef?: ReturnType<typeof BackendGitRefSchema.parse>
  warningRowId?: string
  reportId?: string
  wikiId?: string
  wikiArtifact?: string
  wikiSha?: string
  terminalSessionName?: string
}

function resolveAllowedBackendRoute(pathname: string): AllowedBackendRoute | null {
  if (Object.hasOwn(BACKEND_ROUTE_ALLOW_LIST, pathname)) {
    const key = pathname as keyof typeof BACKEND_ROUTE_ALLOW_LIST
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key] }
  }
  const prefix = BACKEND_API_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tmuxMatch = new RegExp(`^${prefix}/tmux-sessions/([^/]+)(?:/(rename))?$`).exec(pathname)
  if (tmuxMatch) {
    let sessionName: string
    try {
      sessionName = decodeURIComponent(tmuxMatch[1]!)
    } catch {
      return null
    }
    const parsed = TerminalSessionIdSchema.safeParse(sessionName)
    if (!parsed.success || !parsed.data.startsWith('memon-')) return null
    const key = tmuxMatch[2] ? BACKEND_TMUX_RENAME_ROUTE : BACKEND_TMUX_SESSION_ROUTE
    return {
      key,
      methods: BACKEND_ROUTE_ALLOW_LIST[key],
      terminalSessionName: parsed.data,
    }
  }
  const readmeMatch = new RegExp(`^${prefix}/(runs|experiments)/([^/]+)/readme$`).exec(pathname)
  if (readmeMatch) {
    let decodedId: string
    try {
      decodedId = decodeURIComponent(readmeMatch[2]!)
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decodedId)
    if (!resourceId.success) return null
    const key =
      readmeMatch[1] === 'runs' ? BACKEND_RUN_README_ROUTE : BACKEND_EXPERIMENT_README_ROUTE
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const resourceReadMatch = new RegExp(
    `^${prefix}/(runs|experiments)/([^/]+)/(files|results)$`,
  ).exec(pathname)
  if (resourceReadMatch) {
    if (
      (resourceReadMatch[1] === 'runs' && resourceReadMatch[3] !== 'files') ||
      (resourceReadMatch[1] === 'experiments' && resourceReadMatch[3] !== 'results')
    ) {
      return null
    }
    let decodedId: string
    try {
      decodedId = decodeURIComponent(resourceReadMatch[2]!)
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decodedId)
    if (!resourceId.success) return null
    const key =
      resourceReadMatch[1] === 'runs' ? BACKEND_RUN_FILES_ROUTE : BACKEND_EXPERIMENT_RESULTS_ROUTE
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const experimentBindMatch = new RegExp(`^${prefix}/experiments/([^/]+)/(link|unlink)$`).exec(
    pathname,
  )
  if (experimentBindMatch) {
    let decodedId: string
    try {
      decodedId = decodeURIComponent(experimentBindMatch[1]!)
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decodedId)
    if (!resourceId.success) return null
    const key =
      experimentBindMatch[2] === 'link'
        ? BACKEND_EXPERIMENT_LINK_ROUTE
        : BACKEND_EXPERIMENT_UNLINK_ROUTE
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const warningMatch = new RegExp(
    `^${prefix}/(runs|experiments)/([^/]+)/warnings(?:/([^/]+))?$`,
  ).exec(pathname)
  if (warningMatch) {
    let id: string
    let row: string | undefined
    try {
      id = decodeURIComponent(warningMatch[2]!)
      row = warningMatch[3] ? decodeURIComponent(warningMatch[3]) : undefined
    } catch {
      return null
    }
    const resource = ResourceIdSchema.safeParse(id)
    if (!resource.success) return null
    if (row && (!/^w_[A-Za-z0-9_.:-]+$/.test(row) || row.length > 128)) return null
    const key =
      warningMatch[1] === 'runs'
        ? row
          ? BACKEND_RUN_WARNING_ROUTE
          : BACKEND_RUN_WARNINGS_ROUTE
        : row
          ? BACKEND_EXPERIMENT_WARNING_ROUTE
          : BACKEND_EXPERIMENT_WARNINGS_ROUTE
    return {
      key,
      methods: BACKEND_ROUTE_ALLOW_LIST[key],
      resourceId: resource.data,
      ...(row ? { warningRowId: row } : {}),
    }
  }
  const mutationMatch = new RegExp(`^${prefix}/(runs|experiments)/([^/]+)/(status|archive)$`).exec(
    pathname,
  )
  if (mutationMatch) {
    let decoded: string
    try {
      decoded = decodeURIComponent(mutationMatch[2]!)
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decoded)
    if (!resourceId.success) return null
    const key =
      mutationMatch[1] === 'runs'
        ? mutationMatch[3] === 'status'
          ? BACKEND_RUN_STATUS_ROUTE
          : BACKEND_RUN_ARCHIVE_ROUTE
        : mutationMatch[3] === 'status'
          ? BACKEND_EXPERIMENT_STATUS_ROUTE
          : BACKEND_EXPERIMENT_ARCHIVE_ROUTE
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const runMatch = new RegExp(`^${prefix}/runs/([^/]+)$`).exec(pathname)
  const experimentMatch = new RegExp(`^${prefix}/experiments/([^/]+)$`).exec(pathname)
  const resourceMatch = runMatch ?? experimentMatch
  if (resourceMatch?.[1]) {
    let decodedId: string
    try {
      decodedId = decodeURIComponent(resourceMatch[1])
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decodedId)
    if (!resourceId.success) return null
    const key = runMatch ? BACKEND_RUN_ROUTE : BACKEND_EXPERIMENT_ROUTE
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const reportMatch = new RegExp(`^${prefix}/reports/([^/]+)$`).exec(pathname)
  const digestMatch = new RegExp(`^${prefix}/digests/([^/]+)$`).exec(pathname)
  const codeReviewMatch = new RegExp(`^${prefix}/code-reviews/(.+)$`).exec(pathname)
  const documentMatch = reportMatch ?? digestMatch ?? codeReviewMatch
  if (documentMatch?.[1]) {
    let decodedId: string
    try {
      decodedId = decodeURIComponent(documentMatch[1])
    } catch {
      return null
    }
    const resourceId = ResourceIdSchema.safeParse(decodedId)
    if (!resourceId.success) return null
    const key = reportMatch
      ? BACKEND_REPORT_ROUTE
      : digestMatch
        ? BACKEND_DIGEST_ROUTE
        : BACKEND_CODE_REVIEW_ROUTE
    if (key === BACKEND_REPORT_ROUTE && !/^R\d{4}$/.test(resourceId.data)) return null
    if (key === BACKEND_DIGEST_ROUTE && !/^D\d{4}$/.test(resourceId.data)) return null
    if (
      key === BACKEND_CODE_REVIEW_ROUTE &&
      !/^(?:code-review|experiments\/E\d{4}-[a-z0-9-]+\/code-review)\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(
        resourceId.data,
      )
    ) {
      return null
    }
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], resourceId: resourceId.data }
  }
  const reportAssetMatch = new RegExp(`^${prefix}/report-assets/([^/]+)/([^/]+)/(.+)$`).exec(
    pathname,
  )
  if (reportAssetMatch?.[1] && reportAssetMatch[2] && reportAssetMatch[3]) {
    let projectInput: string
    let reportId: string
    let resourceInput: string
    try {
      projectInput = decodeURIComponent(reportAssetMatch[1])
      reportId = decodeURIComponent(reportAssetMatch[2])
      resourceInput = reportAssetMatch[3]
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/')
    } catch {
      return null
    }
    const project = ProjectNameSchema.safeParse(projectInput)
    const resourceId = ResourceIdSchema.safeParse(resourceInput)
    if (!project.success || !/^R\d{4}$/.test(reportId) || !resourceId.success) return null
    return {
      key: BACKEND_REPORT_ASSET_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_REPORT_ASSET_ROUTE],
      project: project.data,
      reportId,
      resourceId: resourceId.data,
    }
  }
  const wikiBacklinksMatch = new RegExp(`^${prefix}/wiki/backlinks/([^/]+)$`).exec(pathname)
  if (wikiBacklinksMatch?.[1]) {
    let wikiArtifact: string
    try {
      wikiArtifact = decodeURIComponent(wikiBacklinksMatch[1])
    } catch {
      return null
    }
    if (
      wikiArtifact.length === 0 ||
      wikiArtifact.length > 512 ||
      wikiArtifact.includes('/') ||
      wikiArtifact.includes('\\') ||
      wikiArtifact.includes('\0')
    ) {
      return null
    }
    return {
      key: BACKEND_WIKI_BACKLINKS_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_WIKI_BACKLINKS_ROUTE],
      wikiArtifact,
    }
  }
  const wikiReviewMarkMatch = new RegExp(`^${prefix}/wiki/review/([^/]+)$`).exec(pathname)
  if (wikiReviewMarkMatch?.[1]) {
    let sha: string
    try {
      sha = decodeURIComponent(wikiReviewMarkMatch[1])
    } catch {
      return null
    }
    // `next` is the CLI's "oldest markable commit" alias; core resolves it.
    if (sha !== 'next' && !/^[0-9a-f]{4,40}$/.test(sha)) return null
    return {
      key: BACKEND_WIKI_REVIEW_MARK_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_WIKI_REVIEW_MARK_ROUTE],
      wikiSha: sha,
    }
  }
  const wikiPageMatch = new RegExp(`^${prefix}/wiki/([^/]+)$`).exec(pathname)
  if (wikiPageMatch?.[1]) {
    let wikiId: string
    try {
      wikiId = decodeURIComponent(wikiPageMatch[1])
    } catch {
      return null
    }
    // Keep the route addressable so the service can return the specified
    // 400 BAD_REQUEST for a non-W wiki identifier.
    return {
      key: BACKEND_WIKI_PAGE_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_WIKI_PAGE_ROUTE],
      wikiId,
    }
  }
  const wikiAssetMatch = new RegExp(`^${prefix}/wiki-assets/([^/]+)/([^/]+)/(.+)$`).exec(pathname)
  if (wikiAssetMatch?.[1] && wikiAssetMatch[2] && wikiAssetMatch[3]) {
    let projectInput: string
    let wikiId: string
    let resourceInput: string
    try {
      projectInput = decodeURIComponent(wikiAssetMatch[1])
      wikiId = decodeURIComponent(wikiAssetMatch[2])
      resourceInput = wikiAssetMatch[3]
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/')
    } catch {
      return null
    }
    const project = ProjectNameSchema.safeParse(projectInput)
    const resourceId = ResourceIdSchema.safeParse(resourceInput)
    if (!project.success || !/^W\d{4}$/.test(wikiId) || !resourceId.success) return null
    return {
      key: BACKEND_WIKI_ASSET_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_WIKI_ASSET_ROUTE],
      project: project.data,
      wikiId,
      resourceId: resourceId.data,
    }
  }
  const gitProjectRoutes = [
    ['git-status', BACKEND_GIT_STATUS_ROUTE],
    ['git-status/files', BACKEND_GIT_STATUS_FILES_ROUTE],
    ['git-branches', BACKEND_GIT_BRANCHES_ROUTE],
    ['git-log', BACKEND_GIT_LOG_ROUTE],
    ['git-commit', BACKEND_GIT_COMMIT_ROUTE],
    ['git-range', BACKEND_GIT_RANGE_ROUTE],
    ['git-diff', BACKEND_GIT_DIFF_ROUTE],
    ['submodules', BACKEND_GIT_SUBMODULES_ROUTE],
    ['commit-marks', BACKEND_GIT_COMMIT_MARKS_ROUTE],
  ] as const
  for (const [suffix, key] of gitProjectRoutes) {
    const match = new RegExp(`^${prefix}/projects/([^/]+)/${suffix.replace('/', '\\/')}$`).exec(
      pathname,
    )
    if (!match?.[1]) continue
    let decodedProject: string
    try {
      decodedProject = decodeURIComponent(match[1])
    } catch {
      return null
    }
    const project = ProjectNameSchema.safeParse(decodedProject)
    if (!project.success) return null
    return { key, methods: BACKEND_ROUTE_ALLOW_LIST[key], project: project.data }
  }
  const commitMarkMatch = new RegExp(`^${prefix}/projects/([^/]+)/commit-marks/([^/]+)$`).exec(
    pathname,
  )
  if (commitMarkMatch?.[1] && commitMarkMatch[2]) {
    let decodedProject: string
    let decodedRef: string
    try {
      decodedProject = decodeURIComponent(commitMarkMatch[1])
      decodedRef = decodeURIComponent(commitMarkMatch[2])
    } catch {
      return null
    }
    const project = ProjectNameSchema.safeParse(decodedProject)
    const gitRef = BackendGitRefSchema.safeParse(decodedRef)
    if (!project.success) return null
    if (!gitRef.success) return null
    return {
      key: BACKEND_GIT_COMMIT_MARK_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_GIT_COMMIT_MARK_ROUTE],
      project: project.data,
      gitRef: gitRef.data,
    }
  }
  const validationMatch = new RegExp(`^${prefix}/projects/([^/]+)/shares/validate$`).exec(pathname)
  const itemMatch = new RegExp(`^${prefix}/projects/([^/]+)/shares/([^/]+)$`).exec(pathname)
  const collectionMatch = new RegExp(`^${prefix}/projects/([^/]+)/shares$`).exec(pathname)
  const match = validationMatch ?? itemMatch ?? collectionMatch
  if (!match?.[1]) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(match[1])
  } catch {
    return null
  }
  const project = ProjectNameSchema.safeParse(decoded)
  if (!project.success) return null
  if (validationMatch) {
    return {
      key: BACKEND_SHARE_VALIDATE_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_SHARE_VALIDATE_ROUTE],
      project: project.data,
    }
  }
  if (itemMatch?.[2]) {
    let id: string
    try {
      id = decodeURIComponent(itemMatch[2])
    } catch {
      return null
    }
    if (!/^shr_[A-Za-z0-9_-]+$/.test(id) || id.length > 128) return null
    return {
      key: BACKEND_SHARE_ITEM_ROUTE,
      methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_SHARE_ITEM_ROUTE],
      project: project.data,
      shareId: id,
    }
  }
  return {
    key: BACKEND_SHARES_ROUTE,
    methods: BACKEND_ROUTE_ALLOW_LIST[BACKEND_SHARES_ROUTE],
    project: project.data,
  }
}

const PROJECT_DATA_ROUTE_KEYS: readonly string[] = [
  BACKEND_RUNS_ROUTE,
  BACKEND_RUN_ROUTE,
  BACKEND_EXPERIMENTS_ROUTE,
  BACKEND_EXPERIMENT_ROUTE,
  BACKEND_RUN_FILES_ROUTE,
  BACKEND_EXPERIMENT_RESULTS_ROUTE,
  BACKEND_HYPOTHESES_ROUTE,
  BACKEND_JOURNAL_ROUTE,
  BACKEND_ANOMALIES_ROUTE,
]

function isProjectDataRoute(key: string): boolean {
  return PROJECT_DATA_ROUTE_KEYS.includes(key)
}

const DOCUMENT_DATA_ROUTE_KEYS: readonly string[] = [
  BACKEND_REPORTS_ROUTE,
  BACKEND_REPORT_ROUTE,
  BACKEND_DIGESTS_ROUTE,
  BACKEND_DIGEST_ROUTE,
  BACKEND_CODE_REVIEWS_ROUTE,
  BACKEND_CODE_REVIEW_ROUTE,
  BACKEND_README_ROUTE,
  BACKEND_RUN_README_ROUTE,
  BACKEND_EXPERIMENT_README_ROUTE,
  BACKEND_WIKI_ROUTE,
  BACKEND_WIKI_PAGE_ROUTE,
  BACKEND_WIKI_BACKLINKS_ROUTE,
]

function isDocumentDataRoute(key: string): boolean {
  return DOCUMENT_DATA_ROUTE_KEYS.includes(key)
}

/**
 * Wiki review marks live in `.memon/wiki-review.csv`, not in Project
 * documents, so they are owner-only shell-class writes that a read-only
 * Backend still accepts.
 */
const WIKI_REVIEW_ROUTE_KEYS: readonly string[] = [
  BACKEND_WIKI_REVIEW_ROUTE,
  BACKEND_WIKI_REVIEW_MARK_ROUTE,
]

function isWikiReviewRoute(key: string): boolean {
  return WIKI_REVIEW_ROUTE_KEYS.includes(key)
}

const GIT_DATA_ROUTE_KEYS: readonly string[] = [
  BACKEND_GIT_STATUS_ROUTE,
  BACKEND_GIT_STATUS_FILES_ROUTE,
  BACKEND_GIT_BRANCHES_ROUTE,
  BACKEND_GIT_LOG_ROUTE,
  BACKEND_GIT_COMMIT_ROUTE,
  BACKEND_GIT_RANGE_ROUTE,
  BACKEND_GIT_DIFF_ROUTE,
  BACKEND_GIT_SUBMODULES_ROUTE,
  BACKEND_GIT_COMMIT_MARKS_ROUTE,
  BACKEND_GIT_COMMIT_MARK_ROUTE,
  BACKEND_CODE_PREVIEW_ROUTE,
]

function isGitDataRoute(key: string): boolean {
  return GIT_DATA_ROUTE_KEYS.includes(key)
}

const STREAM_DATA_ROUTE_KEYS: readonly string[] = [
  BACKEND_LOG_FILES_ROUTE,
  BACKEND_LOG_ROUTE,
  BACKEND_LOG_STREAM_ROUTE,
  BACKEND_REPORT_ASSET_ROUTE,
  BACKEND_WIKI_ASSET_ROUTE,
]

function isStreamDataRoute(key: string): boolean {
  return STREAM_DATA_ROUTE_KEYS.includes(key)
}

const TERMINAL_CONTROL_ROUTE_KEYS: readonly string[] = [
  BACKEND_TERMINAL_CHECK_ROUTE,
  BACKEND_TERMINAL_INSTALL_ROUTE,
  BACKEND_TERMINAL_START_ROUTE,
  BACKEND_TERMINAL_ATTACH_ROUTE,
  BACKEND_TERMINAL_LIST_ROUTE,
  BACKEND_TERMINAL_STOP_ROUTE,
  BACKEND_TERMINAL_HERDR_ROUTE,
]

function isTerminalControlRoute(key: string): boolean {
  return TERMINAL_CONTROL_ROUTE_KEYS.includes(key)
}

function hasSingleValue(search: URLSearchParams, key: string): boolean {
  return search.getAll(key).length === 1
}

function validOptionalSubmodule(search: URLSearchParams): boolean {
  const values = search.getAll('submodule')
  return (
    values.length === 0 || (values.length === 1 && values[0]!.length <= 512 && values[0] !== '')
  )
}

function routeAllowsQuery(
  route: AllowedBackendRoute,
  method: string,
  search: URLSearchParams,
): boolean {
  const keys = [...search.keys()]
  if (
    [
      BACKEND_RUN_STATUS_ROUTE,
      BACKEND_RUN_ARCHIVE_ROUTE,
      BACKEND_EXPERIMENT_STATUS_ROUTE,
      BACKEND_EXPERIMENT_ARCHIVE_ROUTE,
      BACKEND_JOURNAL_APPEND_ROUTE,
      BACKEND_RUN_WARNINGS_ROUTE,
      BACKEND_RUN_WARNING_ROUTE,
      BACKEND_EXPERIMENT_WARNINGS_ROUTE,
      BACKEND_EXPERIMENT_WARNING_ROUTE,
      BACKEND_EXPERIMENT_LINK_ROUTE,
      BACKEND_EXPERIMENT_UNLINK_ROUTE,
    ].includes(route.key)
  ) {
    const projects = search.getAll('project')
    return (
      keys.length === 1 &&
      keys[0] === 'project' &&
      projects.length === 1 &&
      ProjectNameSchema.safeParse(projects[0]).success
    )
  }
  if (route.key === BACKEND_SHARES_ROUTE || route.key === BACKEND_SHARE_ITEM_ROUTE) {
    const projects = search.getAll('project')
    if (projects.length > 1 || (projects.length === 1 && projects[0] !== route.project)) {
      return false
    }
    if (route.key === BACKEND_SHARE_ITEM_ROUTE || method !== 'GET') {
      return keys.every((key) => key === 'project')
    }
    const reveal = search.getAll('reveal')
    return (
      reveal.length <= 1 &&
      (reveal.length === 0 || ['true', 'false'].includes(reveal[0]!)) &&
      keys.every((key) => key === 'project' || key === 'reveal')
    )
  }
  if (isProjectDataRoute(route.key)) {
    const projects = search.getAll('project')
    if (projects.length !== 1 || !ProjectNameSchema.safeParse(projects[0]).success) return false
    if (route.key === BACKEND_EXPERIMENT_ROUTE && method === 'DELETE') {
      const force = search.getAll('force')
      return (
        force.length <= 1 &&
        (force.length === 0 || force[0] === 'true' || force[0] === 'false') &&
        keys.every((key) => key === 'project' || key === 'force')
      )
    }
    const allowed =
      route.key === BACKEND_JOURNAL_ROUTE
        ? new Set(['project', 'limit', 'before', 'countOnly'])
        : route.key === BACKEND_RUN_FILES_ROUTE
          ? new Set(['project', 'depth'])
          : new Set(['project'])
    if (keys.some((key) => !allowed.has(key))) return false
    if (search.getAll('limit').length > 1 || search.getAll('before').length > 1) return false
    const limit = search.get('limit')
    const before = search.get('before')
    const countOnly = search.getAll('countOnly')
    if (limit && !/^\d{1,6}$/.test(limit)) return false
    if (before && before.length > 128) return false
    if (countOnly.length > 1 || (countOnly.length === 1 && countOnly[0] !== '1')) return false
    const depths = search.getAll('depth')
    if (
      depths.length > 1 ||
      (depths[0] !== undefined && !/^[1-6]$/.test(depths[0])) ||
      (route.key !== BACKEND_RUN_FILES_ROUTE && depths.length > 0)
    ) {
      return false
    }
    return true
  }
  if (isDocumentDataRoute(route.key)) {
    const projects = search.getAll('project')
    if (projects.length !== 1 || !ProjectNameSchema.safeParse(projects[0]).success) return false
    if (route.key !== BACKEND_README_ROUTE) {
      return keys.length === 1 && keys[0] === 'project'
    }
    const resources = search.getAll('resource')
    if (resources.length !== 1 || keys.length !== 2) return false
    if (keys.some((key) => key !== 'project' && key !== 'resource')) return false
    const resource = ResourceIdSchema.safeParse(resources[0])
    return (
      resource.success && (resource.data === 'README.md' || resource.data.endsWith('/README.md'))
    )
  }
  if (isGitDataRoute(route.key)) {
    const projects = search.getAll('project')
    if (route.key === BACKEND_CODE_PREVIEW_ROUTE) {
      if (projects.length !== 1 || !ProjectNameSchema.safeParse(projects[0]).success) return false
    } else if (
      !route.project ||
      projects.length > 1 ||
      (projects.length === 1 && projects[0] !== route.project)
    ) {
      return false
    }
    if (!validOptionalSubmodule(search)) return false
    let allowed = new Set(['project'])
    switch (route.key) {
      case BACKEND_GIT_STATUS_ROUTE:
      case BACKEND_GIT_SUBMODULES_ROUTE:
      case BACKEND_GIT_COMMIT_MARKS_ROUTE:
        break
      case BACKEND_GIT_STATUS_FILES_ROUTE:
      case BACKEND_GIT_BRANCHES_ROUTE:
      case BACKEND_GIT_COMMIT_MARK_ROUTE:
        allowed = new Set(['project', 'submodule'])
        break
      case BACKEND_GIT_LOG_ROUTE: {
        allowed = new Set(['project', 'ref', 'limit', 'submodule'])
        if (!hasSingleValue(search, 'ref')) return false
        if (!BackendGitRefSchema.safeParse(search.get('ref')).success) return false
        const limits = search.getAll('limit')
        if (limits.length > 1 || (limits[0] && !/^\d{1,4}$/.test(limits[0]))) return false
        if (limits[0] && (Number(limits[0]) < 1 || Number(limits[0]) > 1000)) return false
        break
      }
      case BACKEND_GIT_COMMIT_ROUTE:
        allowed = new Set(['project', 'sha', 'submodule'])
        if (
          !hasSingleValue(search, 'sha') ||
          !BackendGitRefSchema.safeParse(search.get('sha')).success
        ) {
          return false
        }
        break
      case BACKEND_GIT_RANGE_ROUTE:
        allowed = new Set(['project', 'from', 'to', 'submodule'])
        if (
          !hasSingleValue(search, 'from') ||
          !hasSingleValue(search, 'to') ||
          !BackendGitRefSchema.safeParse(search.get('from')).success ||
          !BackendGitRefSchema.safeParse(search.get('to')).success
        ) {
          return false
        }
        break
      case BACKEND_GIT_DIFF_ROUTE: {
        allowed = new Set(['project', 'path', 'side', 'sha', 'from', 'to', 'submodule'])
        const paths = search.getAll('path')
        const sides = search.getAll('side')
        if (paths.length !== 1 || !ResourceIdSchema.safeParse(paths[0]).success) return false
        if (
          sides.length !== 1 ||
          !['staged', 'unstaged', 'untracked', 'commit', 'range'].includes(sides[0]!)
        ) {
          return false
        }
        if (sides[0] === 'commit') {
          if (
            !hasSingleValue(search, 'sha') ||
            !BackendGitRefSchema.safeParse(search.get('sha')).success ||
            search.has('from') ||
            search.has('to')
          ) {
            return false
          }
        } else if (sides[0] === 'range') {
          if (
            !hasSingleValue(search, 'from') ||
            !hasSingleValue(search, 'to') ||
            !BackendGitRefSchema.safeParse(search.get('from')).success ||
            !BackendGitRefSchema.safeParse(search.get('to')).success ||
            search.has('sha')
          ) {
            return false
          }
        } else if (search.has('sha') || search.has('from') || search.has('to')) return false
        break
      }
      case BACKEND_CODE_PREVIEW_ROUTE: {
        allowed = new Set(['project', 'url'])
        const urls = search.getAll('url')
        if (urls.length !== 1 || urls[0]!.length > 4096) return false
        break
      }
    }
    return keys.every((key) => allowed.has(key))
  }
  if (isWikiReviewRoute(route.key)) {
    const projects = search.getAll('project')
    return (
      keys.length === 1 &&
      keys[0] === 'project' &&
      projects.length === 1 &&
      ProjectNameSchema.safeParse(projects[0]).success
    )
  }
  if (isStreamDataRoute(route.key)) {
    const projects = search.getAll('project')
    if (route.key === BACKEND_REPORT_ASSET_ROUTE || route.key === BACKEND_WIKI_ASSET_ROUTE) {
      return (
        !!route.project &&
        projects.length <= 1 &&
        (projects.length === 0 || projects[0] === route.project) &&
        keys.every((key) => key === 'project')
      )
    }
    if (projects.length !== 1 || !ProjectNameSchema.safeParse(projects[0]).success) return false
    const resources = search.getAll('resource')
    if (resources.length !== 1 || !ResourceIdSchema.safeParse(resources[0]).success) return false
    const allowed =
      route.key === BACKEND_LOG_ROUTE
        ? new Set(['project', 'resource', 'endLine', 'count'])
        : new Set(['project', 'resource'])
    if (keys.some((key) => !allowed.has(key))) return false
    if (route.key !== BACKEND_LOG_ROUTE) return keys.length === 2
    if (search.getAll('endLine').length > 1 || search.getAll('count').length > 1) return false
    const endLine = search.get('endLine')
    const count = search.get('count')
    if (endLine && (!/^\d{1,12}$/.test(endLine) || Number(endLine) < 1)) return false
    if (count && (!/^\d{1,4}$/.test(count) || Number(count) < 1 || Number(count) > 2000)) {
      return false
    }
    return true
  }
  if (route.key === BACKEND_SLURM_STATUS_ROUTE) {
    const projects = search.getAll('project')
    return (
      keys.length === 1 &&
      keys[0] === 'project' &&
      projects.length === 1 &&
      ProjectNameSchema.safeParse(projects[0]).success
    )
  }
  if (isTerminalControlRoute(route.key)) {
    if (route.key !== BACKEND_TERMINAL_START_ROUTE && route.key !== BACKEND_TERMINAL_HERDR_ROUTE) {
      return keys.length === 0
    }
    if (route.key === BACKEND_TERMINAL_HERDR_ROUTE && keys.length === 0) return true
    const projects = search.getAll('project')
    return (
      keys.length === 1 &&
      keys[0] === 'project' &&
      projects.length === 1 &&
      ProjectNameSchema.safeParse(projects[0]).success
    )
  }
  return keys.length === 0
}

function selectedProject(
  search: URLSearchParams,
): ReturnType<typeof ProjectNameSchema.parse> | null {
  const values = search.getAll('project')
  if (values.length !== 1) return null
  const parsed = ProjectNameSchema.safeParse(values[0])
  return parsed.success ? parsed.data : null
}

function selectedReadmeResource(
  search: URLSearchParams,
): ReturnType<typeof ResourceIdSchema.parse> | null {
  const values = search.getAll('resource')
  if (values.length !== 1) return null
  const parsed = ResourceIdSchema.safeParse(values[0])
  if (!parsed.success) return null
  return parsed.data === 'README.md' || parsed.data.endsWith('/README.md') ? parsed.data : null
}

class BackendControlBodyError extends Error {
  constructor(
    public readonly status: 400 | 413,
    public readonly code: Extract<BackendErrorCode, 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE'>,
    message: string,
  ) {
    super(message)
    this.name = 'BackendControlBodyError'
  }
}

async function readBoundedJsonRequest(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new BackendControlBodyError(400, 'BAD_REQUEST', 'JSON request body is required')
  }
  const declaredRaw = request.headers['content-length']
  if (declaredRaw !== undefined) {
    const declared = Number(declaredRaw)
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      throw new BackendControlBodyError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Backend JSON request exceeds the size limit',
      )
    }
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > maxBytes) {
      throw new BackendControlBodyError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Backend JSON request exceeds the size limit',
      )
    }
    chunks.push(bytes)
  }

  let raw: unknown
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    raw = JSON.parse(json)
  } catch {
    throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Backend JSON request is invalid')
  }
  return raw
}

async function readDocumentWriteRequest(request: IncomingMessage) {
  const parsed = BackendDocumentWriteRequestSchema.safeParse(
    await readBoundedJsonRequest(request, MAX_BACKEND_DOCUMENT_BODY_BYTES),
  )
  if (!parsed.success) {
    throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Document write request is invalid')
  }
  return parsed.data
}

async function readCodeReviewPatchRequest(request: IncomingMessage) {
  const parsed = BackendCodeReviewPatchRequestSchema.safeParse(
    await readBoundedJsonRequest(request, MAX_BACKEND_DOCUMENT_BODY_BYTES),
  )
  if (!parsed.success) {
    throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Code-review patch request is invalid')
  }
  return parsed.data
}

async function readCommitMarkWriteRequest(request: IncomingMessage) {
  const parsed = BackendCommitMarkWriteRequestSchema.safeParse(
    await readBoundedJsonRequest(request, MAX_BACKEND_GIT_CONTROL_BODY_BYTES),
  )
  if (!parsed.success) {
    throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Commit-mark request is invalid')
  }
  return parsed.data
}

function writeEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  eventStream: BackendEventStream,
): void {
  response.writeHead(200, {
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
  })
  response.flushHeaders()

  let cleaned = false
  let unsubscribe = () => {}
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    unsubscribe()
    request.off('aborted', cleanup)
    response.off('close', cleanup)
    response.off('error', cleanup)
  }

  request.once('aborted', cleanup)
  response.once('close', cleanup)
  response.once('error', cleanup)
  unsubscribe = eventStream.subscribe((serialized) => {
    if (cleaned || response.destroyed) return false
    if (response.write(serialized)) return true

    // Never build an unbounded application queue behind a slow client. End
    // this stream and let central reconnect/resync from epoch + sequence.
    queueMicrotask(() => {
      cleanup()
      response.end()
    })
    return false
  })
  if (cleaned) unsubscribe()
}

interface ParsedByteRange {
  start: number
  end: number
}

function parseByteRange(header: string, size: number): ParsedByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size <= 0) return null
  const [, startText = '', endText = ''] = match
  if (startText === '' && endText === '') return null
  if (startText === '') {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startText)
  const requestedEnd = endText === '' ? size - 1 : Number(endText)
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function headerMatchesEtag(value: string | undefined, etag: string): boolean {
  if (!value) return false
  return value
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || candidate === etag)
}

function notModified(request: IncomingMessage, resource: BackendByteResource): boolean {
  const noneMatch = request.headers['if-none-match']
  if (typeof noneMatch === 'string') return headerMatchesEtag(noneMatch, resource.etag)
  const modifiedSince = request.headers['if-modified-since']
  if (typeof modifiedSince !== 'string') return false
  const timestamp = Date.parse(modifiedSince)
  return (
    Number.isFinite(timestamp) &&
    Math.floor(resource.mtimeMs / 1000) <= Math.floor(timestamp / 1000)
  )
}

function ifRangeAllows(request: IncomingMessage, resource: BackendByteResource): boolean {
  const value = request.headers['if-range']
  if (typeof value !== 'string') return true
  if (value.startsWith('W/')) return false
  if (value.startsWith('"')) return value === resource.etag
  const timestamp = Date.parse(value)
  return (
    Number.isFinite(timestamp) &&
    Math.floor(resource.mtimeMs / 1000) <= Math.floor(timestamp / 1000)
  )
}

function byteResourceHeaders(resource: BackendByteResource): Record<string, string> {
  return {
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-cache',
    'content-type': resource.contentType,
    etag: resource.etag,
    'last-modified': new Date(resource.mtimeMs).toUTCString(),
    'x-content-type-options': 'nosniff',
    'x-memon-resource-version': resource.version,
  }
}

function requestAbortController(request: IncomingMessage, response: ServerResponse) {
  const controller = new AbortController()
  const abort = () => controller.abort(new Error('Backend downstream disconnected'))
  request.once('aborted', abort)
  response.once('close', abort)
  return {
    signal: controller.signal,
    cleanup: () => {
      request.off('aborted', abort)
      response.off('close', abort)
    },
  }
}

function waitForDrain(response: ServerResponse, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || response.destroyed) return Promise.resolve(false)
  return new Promise((resolveDrain) => {
    const cleanup = () => {
      response.off('drain', onDrain)
      response.off('close', onClose)
      signal.removeEventListener('abort', onClose)
    }
    const onDrain = () => {
      cleanup()
      resolveDrain(true)
    }
    const onClose = () => {
      cleanup()
      resolveDrain(false)
    }
    response.once('drain', onDrain)
    response.once('close', onClose)
    signal.addEventListener('abort', onClose, { once: true })
  })
}

class BackendStreamDeadlineError extends Error {}

function withStreamControlDeadline<T>(
  operation: Promise<T>,
  request: IncomingMessage,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolveOperation, rejectOperation) => {
    const timer = setTimeout(() => {
      cleanup()
      rejectOperation(new BackendStreamDeadlineError('Backend stream control deadline exceeded'))
    }, timeoutMs)
    timer.unref?.()
    const onAbort = () => {
      cleanup()
      rejectOperation(new BackendStreamDeadlineError('Backend stream request aborted'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      request.off('aborted', onAbort)
    }
    request.once('aborted', onAbort)
    operation.then(
      (value) => {
        cleanup()
        resolveOperation(value)
      },
      (error) => {
        cleanup()
        rejectOperation(error)
      },
    )
  })
}

async function streamLogEvents(
  request: IncomingMessage,
  response: ServerResponse,
  service: BackendStreamService,
  project: string,
  resource: string,
): Promise<void> {
  const abort = requestAbortController(request, response)
  response.writeHead(200, {
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
  })
  response.flushHeaders()
  try {
    for await (const event of service.streamLog(project, resource, abort.signal)) {
      if (abort.signal.aborted || response.destroyed) return
      const parsed = BackendLogStreamEventSchema.parse(event)
      const frame = `event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`
      if (Buffer.byteLength(frame) > MAX_BACKEND_CONTROL_JSON_BYTES) {
        const bounded = 'event: error\ndata: {"message":"Backend log event exceeds limit"}\n\n'
        response.write(bounded)
        return
      }
      if (!response.write(frame) && !(await waitForDrain(response, abort.signal))) return
    }
  } catch {
    if (!abort.signal.aborted && !response.destroyed) {
      response.write('event: error\ndata: {"message":"Backend log stream is unavailable"}\n\n')
    }
  } finally {
    abort.cleanup()
    if (!response.destroyed && !response.writableEnded) response.end()
  }
}

async function streamByteResource(
  request: IncomingMessage,
  response: ServerResponse,
  service: BackendStreamService,
  resource: BackendByteResource,
): Promise<void> {
  const headers = byteResourceHeaders(resource)
  if (notModified(request, resource)) {
    response.writeHead(304, headers)
    response.end()
    return
  }
  const rangeHeader = request.headers.range
  let range: ParsedByteRange | undefined
  if (typeof rangeHeader === 'string' && ifRangeAllows(request, resource)) {
    const parsed = parseByteRange(rangeHeader, resource.size)
    if (!parsed) {
      response.writeHead(416, {
        ...headers,
        'content-length': '0',
        'content-range': `bytes */${resource.size}`,
      })
      response.end()
      return
    }
    range = parsed
  }
  const contentLength = range ? range.end - range.start + 1 : resource.size
  response.writeHead(range ? 206 : 200, {
    ...headers,
    'content-length': String(contentLength),
    ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${resource.size}` } : {}),
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const abort = requestAbortController(request, response)
  try {
    await pipeline(service.openByteStream(resource, range), response, { signal: abort.signal })
  } catch {
    if (!abort.signal.aborted && !response.destroyed) response.destroy()
  } finally {
    abort.cleanup()
  }
}

/**
 * Framework-neutral Backend HTTP handler. Route families extend the fixed
 * `/api/backend/v1` allow-list instead of forwarding arbitrary Web paths.
 */
export function createBackendHandler(options: BackendServerOptions): BackendHandler {
  const resolved = resolveOptions(options)
  return createResolvedBackendHandler(resolved)
}

async function handleTerminalControlRoute(
  request: IncomingMessage,
  response: ServerResponse,
  route: AllowedBackendRoute,
  parsedUrl: URL,
  resolved: ResolvedBackendOptions,
): Promise<void> {
  let actor: ReturnType<typeof decodeBackendActorContext>
  try {
    actor = decodeBackendActorContext({
      serviceAuthenticated: true,
      headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
    })
  } catch (error) {
    if (error instanceof BackendActorContextError) {
      writeError(
        response,
        error.status,
        error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
        error.message,
      )
      return
    }
    throw error
  }
  if (actor.role !== 'owner') {
    writeError(response, 403, 'FORBIDDEN', 'owner actor is required for terminal lifecycle')
    return
  }
  if (!resolved.capabilities.terminal || !resolved.terminalService) {
    writeError(response, 409, 'CONFLICT', 'Backend terminal capability is unavailable')
    return
  }
  if (route.key === BACKEND_TERMINAL_HERDR_ROUTE && !resolved.capabilities.herdr) {
    writeError(response, 409, 'CONFLICT', 'Backend Herdr capability is unavailable')
    return
  }

  try {
    switch (route.key) {
      case BACKEND_TERMINAL_CHECK_ROUTE:
        writeJson(
          response,
          200,
          BackendTerminalCheckResponseSchema.parse(await resolved.terminalService.check()),
        )
        return
      case BACKEND_TERMINAL_INSTALL_ROUTE:
        writeJson(
          response,
          200,
          BackendTerminalInstallResponseSchema.parse(await resolved.terminalService.install()),
        )
        return
      case BACKEND_TERMINAL_LIST_ROUTE:
        writeJson(
          response,
          200,
          BackendTerminalListResponseSchema.parse(await resolved.terminalService.list()),
        )
        return
      case BACKEND_TERMINAL_START_ROUTE: {
        const input = BackendTerminalStartRequestSchema.safeParse(
          await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES),
        )
        if (!input.success || selectedProject(parsedUrl.searchParams) !== input.data.project) {
          throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Terminal start request is invalid')
        }
        writeJson(
          response,
          200,
          BackendTerminalStartResponseSchema.parse(
            await resolved.terminalService.start(input.data),
          ),
        )
        return
      }
      case BACKEND_TERMINAL_ATTACH_ROUTE: {
        const input = BackendTerminalAttachRequestSchema.safeParse(
          await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES),
        )
        if (!input.success) {
          throw new BackendControlBodyError(
            400,
            'BAD_REQUEST',
            'Terminal attach request is invalid',
          )
        }
        writeJson(
          response,
          200,
          BackendTerminalStartResponseSchema.parse(
            await resolved.terminalService.attach(input.data),
          ),
        )
        return
      }
      case BACKEND_TERMINAL_STOP_ROUTE: {
        const input = BackendTerminalStopRequestSchema.safeParse(
          await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES),
        )
        if (!input.success) {
          throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Terminal stop request is invalid')
        }
        writeJson(
          response,
          200,
          BackendTerminalStopResponseSchema.parse(await resolved.terminalService.stop(input.data)),
        )
        return
      }
      case BACKEND_TERMINAL_HERDR_ROUTE: {
        const input = BackendHerdrStartRequestSchema.safeParse(
          await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES),
        )
        const queryProject = selectedProject(parsedUrl.searchParams)
        if (
          !input.success ||
          (input.data.project !== undefined && queryProject !== input.data.project) ||
          (input.data.project === undefined && queryProject !== null)
        ) {
          throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Herdr start request is invalid')
        }
        writeJson(
          response,
          200,
          BackendTerminalStartResponseSchema.parse(
            await resolved.terminalService.startHerdr(input.data),
          ),
        )
        return
      }
    }
  } catch (error) {
    if (error instanceof BackendControlBodyError) {
      writeError(response, error.status, error.code, error.message)
      return
    }
    if (error instanceof BackendTerminalServiceError) {
      const status =
        error.code === 'BAD_REQUEST' ? 400 : error.code === 'PROJECT_NOT_FOUND' ? 404 : 503
      writeError(
        response,
        status,
        status === 400 ? 'BAD_REQUEST' : status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE',
        status >= 500 ? 'Backend terminal operation failed' : error.message,
        status >= 500,
      )
      return
    }
    writeError(response, 503, 'UNAVAILABLE', 'Backend terminal operation failed', true)
  }
}

async function handleTmuxControlRoute(
  request: IncomingMessage,
  response: ServerResponse,
  route: AllowedBackendRoute,
  resolved: ResolvedBackendOptions,
): Promise<void> {
  let actor: ReturnType<typeof decodeBackendActorContext>
  try {
    actor = decodeBackendActorContext({
      serviceAuthenticated: true,
      headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
    })
  } catch (error) {
    if (error instanceof BackendActorContextError) {
      writeError(response, error.status, 'BAD_REQUEST', error.message)
      return
    }
    throw error
  }
  if (actor.role !== 'owner') {
    writeError(response, 403, 'FORBIDDEN', 'owner actor is required for tmux management')
    return
  }
  if (!resolved.capabilities.tmux || !resolved.terminalService) {
    writeError(response, 409, 'CONFLICT', 'Backend tmux capability is unavailable')
    return
  }

  try {
    const method = request.method ?? ''
    if (route.key === BACKEND_TMUX_SESSIONS_ROUTE && method === 'GET') {
      writeJson(
        response,
        200,
        BackendTmuxSessionsResponseSchema.parse(await resolved.terminalService.listTmux()),
      )
      return
    }
    if (route.key === BACKEND_TMUX_SESSIONS_ROUTE && method === 'POST') {
      const input = BackendTmuxCreateRequestSchema.parse(
        await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES),
      )
      writeJson(
        response,
        200,
        BackendTmuxCreateResponseSchema.parse(await resolved.terminalService.createTmux(input)),
      )
      return
    }
    if (!route.terminalSessionName) {
      throw new BackendTerminalServiceError('BAD_REQUEST', 'tmux session selector is invalid')
    }
    if (route.key === BACKEND_TMUX_SESSION_ROUTE && method === 'GET') {
      writeJson(
        response,
        200,
        BackendTmuxSessionResponseSchema.parse(
          await resolved.terminalService.getTmux(route.terminalSessionName),
        ),
      )
      return
    }
    if (route.key === BACKEND_TMUX_SESSION_ROUTE && method === 'DELETE') {
      writeJson(
        response,
        200,
        BackendTmuxKillResponseSchema.parse(
          await resolved.terminalService.killTmux(route.terminalSessionName),
        ),
      )
      return
    }
    if (route.key === BACKEND_TMUX_RENAME_ROUTE) {
      const input = BackendTmuxRenameRequestSchema.parse(
        await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES),
      )
      writeJson(
        response,
        200,
        BackendTmuxRenameResponseSchema.parse(
          await resolved.terminalService.renameTmux(route.terminalSessionName, input),
        ),
      )
      return
    }
  } catch (error) {
    if (error instanceof BackendControlBodyError) {
      writeError(response, error.status, error.code, error.message)
      return
    }
    if (error instanceof BackendTerminalServiceError) {
      const status =
        error.code === 'BAD_REQUEST'
          ? 400
          : error.code === 'CONFLICT'
            ? 409
            : error.code === 'PROJECT_NOT_FOUND'
              ? 404
              : 503
      writeError(
        response,
        status,
        status === 400
          ? 'BAD_REQUEST'
          : status === 409
            ? 'CONFLICT'
            : status === 404
              ? 'NOT_FOUND'
              : 'UNAVAILABLE',
        status >= 500 ? 'Backend tmux operation failed' : error.message,
        status >= 500,
      )
      return
    }
    writeError(response, 400, 'BAD_REQUEST', 'Backend tmux request is invalid')
  }
}

function createResolvedBackendHandler(resolved: ResolvedBackendOptions): BackendHandler {
  return async (request, response) => {
    const requestTarget = request.url ?? '/'
    let pathname: string
    let parsedUrl: URL
    try {
      parsedUrl = new URL(requestTarget, 'http://backend.invalid')
      pathname = parsedUrl.pathname
    } catch {
      // A malformed origin-form target that visibly selects the protected
      // namespace still authenticates before receiving a generic route result.
      const rawPath = rawOriginFormPath(requestTarget)
      if (rawPath && isBackendNamespacePath(rawPath)) {
        if (!authenticates(request, resolved.serviceTokens)) {
          writeError(response, 401, 'UNAUTHORIZED', 'Backend service authentication failed')
        } else {
          writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
        }
        return
      }
      writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
      return
    }

    // Paths outside the static Backend namespace are not a service-auth
    // surface. Inside it, authentication intentionally precedes route lookup
    // so an unauthenticated caller cannot enumerate current/future features.
    if (!isBackendNamespacePath(pathname)) {
      writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
      return
    }

    if (!authenticates(request, resolved.serviceTokens)) {
      // No WWW-Authenticate challenge: this endpoint accepts service Bearer
      // credentials only and must never trigger browser Basic-auth handling.
      writeError(response, 401, 'UNAUTHORIZED', 'Backend service authentication failed')
      return
    }

    // Accept only canonical origin-form paths. WHATWG URL parsing normalizes
    // dot segments; without this check `/operations/../meta` could alias the
    // registered metadata route. Metadata also takes no query/fragment input.
    const rawPath = rawOriginFormPath(requestTarget)
    if (rawPath === null || rawPath !== pathname || parsedUrl.hash !== '') {
      writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
      return
    }

    const route = resolveAllowedBackendRoute(pathname)
    if (!route) {
      writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
      return
    }
    const methods = route.methods
    const method = request.method ?? ''
    if (!routeAllowsQuery(route, method, parsedUrl.searchParams)) {
      writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
      return
    }
    if (
      isProjectDataRoute(route.key) &&
      method !== 'GET' &&
      !(
        (route.key === BACKEND_EXPERIMENTS_ROUTE && method === 'POST') ||
        (route.key === BACKEND_EXPERIMENT_ROUTE && method === 'DELETE')
      )
    ) {
      writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
      return
    }
    if (!(methods as readonly string[]).includes(method)) {
      response.setHeader('allow', methods.join(', '))
      writeError(response, 405, 'METHOD_NOT_ALLOWED', 'method not allowed')
      return
    }
    if (
      resolved.readOnly &&
      method !== 'GET' &&
      method !== 'HEAD' &&
      route.key !== BACKEND_SHARE_VALIDATE_ROUTE &&
      route.key !== BACKEND_SHARES_ROUTE &&
      route.key !== BACKEND_SHARE_ITEM_ROUTE &&
      // A review mark records human trust in `.memon/`, not Project content.
      route.key !== BACKEND_WIKI_REVIEW_MARK_ROUTE
    ) {
      writeError(response, 403, 'FORBIDDEN', 'Backend is configured read-only')
      return
    }

    if (
      (route.key === BACKEND_EXPERIMENTS_ROUTE && method === 'POST') ||
      (route.key === BACKEND_EXPERIMENT_ROUTE && method === 'DELETE') ||
      route.key === BACKEND_EXPERIMENT_LINK_ROUTE ||
      route.key === BACKEND_EXPERIMENT_UNLINK_ROUTE
    ) {
      if (!resolved.mutationService || !resolved.capabilities.mutations) {
        writeError(response, 404, 'UNSUPPORTED_CAPABILITY', 'Mutation service is unavailable')
        return
      }
      const project = selectedProject(parsedUrl.searchParams)
      if (!project) {
        writeError(response, 400, 'BAD_REQUEST', 'exact Project selector is required')
        return
      }
      try {
        const actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
        const authorization = authorizeBackendActor({
          actor,
          target: { host: resolved.host, project },
          routeClass: 'mutating',
        })
        if (!authorization.ok) {
          writeError(response, 403, 'FORBIDDEN', authorization.message)
          return
        }
        const raw = await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES)
        if (route.key === BACKEND_EXPERIMENTS_ROUTE) {
          const { project: bodyProject, ...input } = BackendExperimentCreateRequestSchema.parse(raw)
          if (bodyProject !== undefined && bodyProject !== project) {
            writeError(response, 400, 'BAD_REQUEST', 'body Project does not match selector')
            return
          }
          const result = BackendExperimentCreateResponseSchema.parse(
            await resolved.mutationService.createExperiment(project, input),
          )
          writeJson(response, 200, result)
          resolved.eventStream.publish({
            project,
            topic: 'experiment-change',
            data: { type: 'set', id: result.id },
          })
          if (input.fromRun) {
            resolved.eventStream.publish({
              project,
              topic: 'run-change',
              data: { type: 'set', id: input.fromRun, parentExperimentId: result.id },
            })
          }
          publishJournalChange(resolved.eventStream, project)
          return
        }
        if (!route.resourceId) {
          writeError(response, 400, 'BAD_REQUEST', 'resource id is required')
          return
        }
        if (route.key === BACKEND_EXPERIMENT_ROUTE) {
          const input = BackendExperimentDeleteRequestSchema.parse({
            ...(raw as object),
            force: parsedUrl.searchParams.get('force') === 'true',
          })
          const result = BackendExperimentDeleteResponseSchema.parse(
            await resolved.mutationService.deleteExperiment(project, route.resourceId, input),
          )
          writeJson(response, 200, result)
          resolved.eventStream.publish({
            project,
            topic: 'experiment-change',
            data: { type: 'delete', id: result.deletedId },
          })
          for (const runId of result.cascadedRuns) {
            resolved.eventStream.publish({
              project,
              topic: 'run-change',
              data: { type: 'set', id: runId, parentExperimentId: null },
            })
          }
          publishJournalChange(resolved.eventStream, project)
          return
        }
        const input = BackendExperimentBindRequestSchema.parse(raw)
        const operation = route.key === BACKEND_EXPERIMENT_LINK_ROUTE ? 'link' : 'unlink'
        const result = BackendExperimentBindResponseSchema.parse(
          await resolved.mutationService.bindExperiment(
            operation,
            project,
            route.resourceId,
            input,
          ),
        )
        writeJson(response, 200, result)
        resolved.eventStream.publish({
          project,
          topic: 'experiment-change',
          data: { type: 'set', id: result.experimentId },
        })
        resolved.eventStream.publish({
          project,
          topic: 'run-change',
          data: {
            type: 'set',
            id: result.runId,
            parentExperimentId: operation === 'link' ? result.experimentId : null,
          },
        })
        publishJournalChange(resolved.eventStream, project)
        return
      } catch (error) {
        if (error instanceof BackendMutationError) {
          if (error.code === 'CONFLICT') {
            writeJson(
              response,
              409,
              BackendDocumentConflictResponseSchema.parse({
                error: { code: 'CONFLICT', message: error.message },
                currentMtime: error.current?.mtime,
                currentHash: error.current?.hash,
              }),
            )
            return
          }
          const status = mutationErrorStatus(error)
          writeError(
            response,
            status,
            status === 409
              ? 'CONFLICT'
              : status === 400
                ? 'BAD_REQUEST'
                : status === 403
                  ? 'FORBIDDEN'
                  : status === 404
                    ? 'NOT_FOUND'
                    : 'INTERNAL',
            status >= 500 ? 'Backend Experiment mutation failed' : error.message,
          )
          return
        }
        writeError(response, 400, 'BAD_REQUEST', 'Experiment mutation request is invalid')
        return
      }
    }

    if (
      [
        BACKEND_RUN_WARNINGS_ROUTE,
        BACKEND_RUN_WARNING_ROUTE,
        BACKEND_EXPERIMENT_WARNINGS_ROUTE,
        BACKEND_EXPERIMENT_WARNING_ROUTE,
      ].includes(route.key)
    ) {
      if (!resolved.mutationService || (method !== 'GET' && !resolved.capabilities.mutations)) {
        writeError(response, 404, 'UNSUPPORTED_CAPABILITY', 'Warning service is unavailable')
        return
      }
      const project = selectedProject(parsedUrl.searchParams)
      if (!project || !route.resourceId) {
        writeError(response, 400, 'BAD_REQUEST', 'exact Project/resource selector is required')
        return
      }
      try {
        const actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
        const authorization = authorizeBackendActor({
          actor,
          target: { host: resolved.host, project },
          routeClass: method === 'GET' ? 'read' : 'mutating',
        })
        if (!authorization.ok) {
          writeError(response, 403, 'FORBIDDEN', authorization.message)
          return
        }
        const kind =
          route.key === BACKEND_RUN_WARNINGS_ROUTE || route.key === BACKEND_RUN_WARNING_ROUTE
            ? 'run'
            : 'experiment'
        if (method === 'GET') {
          writeJson(
            response,
            200,
            BackendWarningsResponseSchema.parse(
              await resolved.mutationService.listWarnings(kind, project, route.resourceId),
            ),
          )
          return
        }
        const raw = await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES)
        const forcedOp = method === 'DELETE' ? 'delete' : method === 'POST' ? 'add' : undefined
        const input = BackendWarningMutationRequestSchema.parse({
          ...(raw as object),
          ...(forcedOp ? { op: forcedOp } : {}),
        })
        const result = await resolved.mutationService.mutateWarning(
          kind,
          project,
          route.resourceId,
          { ...input, rowId: route.warningRowId ?? input.rowId },
        )
        writeJson(response, 200, BackendWarningMutationResponseSchema.parse(result))
        resolved.eventStream.publish({
          project,
          topic: kind === 'run' ? 'run-change' : 'experiment-change',
          data: { type: 'set', id: route.resourceId },
        })
        return
      } catch (error) {
        if (error instanceof BackendMutationError) {
          if (error.code === 'CONFLICT') {
            writeJson(
              response,
              409,
              BackendDocumentConflictResponseSchema.parse({
                error: { code: 'CONFLICT', message: error.message },
                currentMtime: error.current?.mtime,
                currentHash: error.current?.hash,
              }),
            )
            return
          }
          if (error.code === 'WARNINGS_SECTION_NOT_TABLE') {
            writeError(response, 409, 'CONFLICT', error.message)
            return
          }
          writeError(
            response,
            error.code === 'FORBIDDEN' ? 403 : error.code === 'BAD_REQUEST' ? 400 : 404,
            error.code === 'FORBIDDEN'
              ? 'FORBIDDEN'
              : error.code === 'BAD_REQUEST'
                ? 'BAD_REQUEST'
                : 'NOT_FOUND',
            error.message,
          )
          return
        }
        writeError(response, 400, 'BAD_REQUEST', 'Warning request is invalid')
        return
      }
    }

    if (
      [
        BACKEND_RUN_STATUS_ROUTE,
        BACKEND_RUN_ARCHIVE_ROUTE,
        BACKEND_EXPERIMENT_STATUS_ROUTE,
        BACKEND_EXPERIMENT_ARCHIVE_ROUTE,
        BACKEND_JOURNAL_APPEND_ROUTE,
      ].includes(route.key)
    ) {
      if (!resolved.mutationService || !resolved.capabilities.mutations) {
        writeError(response, 404, 'UNSUPPORTED_CAPABILITY', 'Mutation service is unavailable')
        return
      }
      const project = selectedProject(parsedUrl.searchParams)
      if (!project) {
        writeError(response, 400, 'BAD_REQUEST', 'exact Project selector is required')
        return
      }
      try {
        const actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
        const authorization = authorizeBackendActor({
          actor,
          target: { host: resolved.host, project },
          routeClass: 'mutating',
        })
        if (!authorization.ok) {
          writeError(response, 403, 'FORBIDDEN', authorization.message)
          return
        }
        const raw = await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES)
        if (route.key === BACKEND_JOURNAL_APPEND_ROUTE) {
          const input = BackendJournalAppendRequestSchema.parse(raw)
          const result = BackendJournalAppendResponseSchema.parse(
            await resolved.mutationService.appendJournal(project, input),
          )
          writeJson(response, 200, result)
          resolved.eventStream.publish({
            project,
            topic: 'journal-change',
            data: { type: 'append' },
          })
          return
        }
        if (!route.resourceId) {
          writeError(response, 400, 'BAD_REQUEST', 'resource id is required')
          return
        }
        if (
          route.key === BACKEND_RUN_STATUS_ROUTE ||
          route.key === BACKEND_EXPERIMENT_STATUS_ROUTE
        ) {
          const input = BackendStatusMutationRequestSchema.parse(raw)
          const result =
            route.key === BACKEND_RUN_STATUS_ROUTE
              ? await resolved.mutationService.setRunStatus(project, route.resourceId, input)
              : await resolved.mutationService.setExperimentStatus(project, route.resourceId, input)
          writeJson(response, 200, BackendMutationResponseSchema.parse(result))
          resolved.eventStream.publish({
            project,
            topic: route.key === BACKEND_RUN_STATUS_ROUTE ? 'run-change' : 'experiment-change',
            data: { type: 'set', id: route.resourceId },
          })
          return
        }
        const input = BackendArchiveMutationRequestSchema.parse(raw)
        const result =
          route.key === BACKEND_RUN_ARCHIVE_ROUTE
            ? await resolved.mutationService.setRunArchived(project, route.resourceId, input)
            : await resolved.mutationService.setExperimentArchived(project, route.resourceId, input)
        writeJson(response, 200, BackendMutationResponseSchema.parse(result))
        resolved.eventStream.publish({
          project,
          topic: route.key === BACKEND_RUN_ARCHIVE_ROUTE ? 'run-change' : 'experiment-change',
          data: { type: 'set', id: route.resourceId },
        })
        return
      } catch (error) {
        if (error instanceof BackendMutationError) {
          if (error.code === 'CONFLICT') {
            writeJson(
              response,
              409,
              BackendDocumentConflictResponseSchema.parse({
                error: { code: 'CONFLICT', message: error.message },
                currentMtime: error.current?.mtime,
                currentHash: error.current?.hash,
              }),
            )
            return
          }
          writeError(
            response,
            error.code === 'FORBIDDEN' ? 403 : 404,
            error.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND',
            error.message,
          )
          return
        }
        writeError(response, 400, 'BAD_REQUEST', 'Mutation request is invalid')
        return
      }
    }

    if (pathname === BACKEND_EVENTS_PATH) {
      writeEventStream(request, response, resolved.eventStream)
      return
    }

    if (isStreamDataRoute(route.key)) {
      const project = route.project ?? selectedProject(parsedUrl.searchParams)
      const capabilityAvailable =
        route.key === BACKEND_REPORT_ASSET_ROUTE
          ? resolved.capabilities.reportAssets
          : route.key === BACKEND_WIKI_ASSET_ROUTE
            ? resolved.capabilities.wikiAssets
            : route.key === BACKEND_LOG_STREAM_ROUTE
              ? resolved.capabilities.logStreaming
              : resolved.capabilities.projects
      if (!project || !resolved.streamService || !capabilityAvailable) {
        writeError(response, 404, 'NOT_FOUND', 'Backend stream route not found')
        return
      }
      let actor: ReturnType<typeof decodeBackendActorContext>
      try {
        actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
      } catch (error) {
        if (error instanceof BackendActorContextError) {
          writeError(
            response,
            error.status,
            error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
            error.message,
          )
          return
        }
        throw error
      }
      const authorization = authorizeBackendActor({
        actor,
        target: { host: resolved.host, project },
        routeClass: 'read',
      })
      if (!authorization.ok) {
        writeError(response, 403, 'FORBIDDEN', authorization.message)
        return
      }
      try {
        if (route.key === BACKEND_REPORT_ASSET_ROUTE) {
          if (!route.reportId || !route.resourceId) {
            throw new BackendStreamServiceError('INVALID_RESOURCE', '')
          }
          const asset = await withStreamControlDeadline(
            resolved.streamService.resolveReportAsset(project, route.reportId, route.resourceId),
            request,
            resolved.streamControlDeadlineMs,
          )
          await streamByteResource(request, response, resolved.streamService, asset)
          return
        }
        if (route.key === BACKEND_WIKI_ASSET_ROUTE) {
          if (!route.wikiId || !route.resourceId) {
            throw new BackendStreamServiceError('INVALID_RESOURCE', '')
          }
          const asset = await withStreamControlDeadline(
            resolved.streamService.resolveWikiAsset(project, route.wikiId, route.resourceId),
            request,
            resolved.streamControlDeadlineMs,
          )
          await streamByteResource(request, response, resolved.streamService, asset)
          return
        }
        const resource = parsedUrl.searchParams.get('resource')!
        if (route.key === BACKEND_LOG_FILES_ROUTE) {
          writeJson(
            response,
            200,
            BackendLogFilesResponseSchema.parse(
              await withStreamControlDeadline(
                resolved.streamService.listLogFiles(project, resource),
                request,
                resolved.streamControlDeadlineMs,
              ),
            ),
          )
          return
        }
        if (route.key === BACKEND_LOG_ROUTE) {
          writeJson(
            response,
            200,
            BackendLogLinesResponseSchema.parse(
              await withStreamControlDeadline(
                resolved.streamService.readLogLines(project, resource, {
                  ...(parsedUrl.searchParams.get('endLine')
                    ? { endLine: Number(parsedUrl.searchParams.get('endLine')) }
                    : {}),
                  ...(parsedUrl.searchParams.get('count')
                    ? { count: Number(parsedUrl.searchParams.get('count')) }
                    : {}),
                }),
                request,
                resolved.streamControlDeadlineMs,
              ),
            ),
          )
          return
        }
        await withStreamControlDeadline(
          resolved.streamService.validateLogResource(project, resource),
          request,
          resolved.streamControlDeadlineMs,
        )
        await streamLogEvents(request, response, resolved.streamService, project, resource)
        return
      } catch (error) {
        if (response.headersSent) {
          if (!response.destroyed && !response.writableEnded) response.end()
          return
        }
        if (error instanceof BackendStreamDeadlineError) {
          writeError(response, 504, 'UNAVAILABLE', 'Backend stream control deadline exceeded', true)
          return
        }
        if (error instanceof BackendStreamServiceError) {
          if (error.code === 'INVALID_RESOURCE') {
            writeError(response, 400, 'BAD_REQUEST', 'Backend stream resource is invalid')
          } else if (error.code === 'AMBIGUOUS_RESOURCE') {
            writeError(response, 409, 'CONFLICT', 'Backend stream resource is ambiguous')
          } else {
            writeError(response, 404, 'NOT_FOUND', 'Backend stream resource not found')
          }
          return
        }
        writeError(response, 500, 'INTERNAL', 'Backend stream operation failed')
        return
      }
    }

    if (route.key === BACKEND_SLURM_STATUS_ROUTE) {
      if (resolved.readOnly || !resolved.capabilities.slurm || !resolved.slurmService) {
        writeError(response, 404, 'INTEGRATION_DISABLED', 'Slurm integration is disabled')
        return
      }
      const project = selectedProject(parsedUrl.searchParams)
      if (!project) {
        writeError(response, 400, 'BAD_REQUEST', 'exact Project selector is required')
        return
      }
      try {
        const actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
        const authorization = authorizeBackendActor({
          actor,
          target: { host: resolved.host, project },
          routeClass: 'read',
        })
        if (!authorization.ok) {
          writeError(response, 403, 'FORBIDDEN', authorization.message)
          return
        }
        writeJson(
          response,
          200,
          BackendSlurmStatusSchema.parse(await resolved.slurmService.status()),
        )
      } catch (error) {
        if (error instanceof BackendActorContextError) {
          writeError(
            response,
            error.status,
            error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
            error.message,
          )
        } else writeError(response, 503, 'UNAVAILABLE', 'Backend Slurm status is unavailable', true)
      }
      return
    }

    if (isTerminalControlRoute(route.key)) {
      await handleTerminalControlRoute(request, response, route, parsedUrl, resolved)
      return
    }

    if (
      route.key === BACKEND_TMUX_SESSIONS_ROUTE ||
      route.key === BACKEND_TMUX_SESSION_ROUTE ||
      route.key === BACKEND_TMUX_RENAME_ROUTE
    ) {
      await handleTmuxControlRoute(request, response, route, resolved)
      return
    }

    if (pathname === BACKEND_PROJECTS_PATH) {
      let actor: ReturnType<typeof decodeBackendActorContext>
      try {
        actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
      } catch (error) {
        if (error instanceof BackendActorContextError) {
          writeError(
            response,
            error.status,
            error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
            error.message,
          )
          return
        }
        throw error
      }

      let discovered: unknown
      try {
        discovered = await resolved.projectDiscovery()
      } catch {
        writeError(response, 503, 'UNAVAILABLE', 'Backend Project discovery failed', true)
        return
      }
      const parsedProjects = BackendProjectDiscoverySchema.safeParse(discovered)
      if (!parsedProjects.success) {
        writeError(response, 500, 'INTERNAL', 'Backend Project discovery returned invalid data')
        return
      }

      const projects = parsedProjects.data.flatMap(({ name, ...safeMetadata }) => {
        const target = { host: resolved.host, project: name }
        const authorization = authorizeBackendActor({ actor, target, routeClass: 'read' })
        return authorization.ok ? [{ ...target, ...safeMetadata }] : []
      })
      const payload = BackendProjectsResponseSchema.safeParse({ projects })
      if (!payload.success) {
        writeError(response, 500, 'INTERNAL', 'Backend Project response validation failed')
        return
      }
      writeJson(response, 200, payload.data)
      return
    }

    if (isProjectDataRoute(route.key)) {
      const project = selectedProject(parsedUrl.searchParams)
      if (!project || !resolved.projectService) {
        writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
        return
      }
      let actor: ReturnType<typeof decodeBackendActorContext>
      try {
        actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
      } catch (error) {
        if (error instanceof BackendActorContextError) {
          writeError(response, error.status, 'BAD_REQUEST', error.message)
          return
        }
        throw error
      }
      const authorization = authorizeBackendActor({
        actor,
        target: { host: resolved.host, project },
        routeClass: 'read',
      })
      if (!authorization.ok) {
        writeError(response, 403, 'FORBIDDEN', authorization.message)
        return
      }

      try {
        let payload: unknown
        switch (route.key) {
          case BACKEND_RUNS_ROUTE:
            payload = BackendRunsResponseSchema.parse(
              await resolved.projectService.listRuns(project),
            )
            break
          case BACKEND_RUN_ROUTE:
            if (!route.resourceId) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', '')
            payload = BackendRunResponseSchema.parse(
              await resolved.projectService.getRun(project, route.resourceId),
            )
            break
          case BACKEND_EXPERIMENTS_ROUTE:
            payload = BackendExperimentsResponseSchema.parse(
              await resolved.projectService.listExperiments(project),
            )
            break
          case BACKEND_EXPERIMENT_ROUTE: {
            if (!route.resourceId) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', '')
            const detail = await resolved.projectService.getExperiment(project, route.resourceId)
            // Wiki backlinks live with the wiki projection, not the Project
            // snapshot; a Backend without a document service reports none.
            const citedBy = resolved.documentService
              ? await resolved.documentService.wikiBacklinks(project, route.resourceId)
              : []
            payload = BackendExperimentResponseSchema.parse({
              ...(detail as Record<string, unknown>),
              citedBy,
            })
            break
          }
          case BACKEND_RUN_FILES_ROUTE:
            if (!route.resourceId) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', '')
            payload = BackendRunFilesResponseSchema.parse(
              await resolved.projectService.getRunFiles(
                project,
                route.resourceId,
                Number(parsedUrl.searchParams.get('depth') ?? 3),
              ),
            )
            break
          case BACKEND_EXPERIMENT_RESULTS_ROUTE:
            if (!route.resourceId) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', '')
            payload = BackendExperimentResultsResponseSchema.parse(
              await resolved.projectService.getExperimentResults(project, route.resourceId),
            )
            break
          case BACKEND_HYPOTHESES_ROUTE:
            payload = BackendHypothesesResponseSchema.parse(
              await resolved.projectService.getHypotheses(project),
            )
            break
          case BACKEND_JOURNAL_ROUTE: {
            const journal = BackendJournalResponseSchema.parse(
              await resolved.projectService.getJournal(project),
            )
            if (parsedUrl.searchParams.get('countOnly') === '1') {
              payload = BackendJournalCountResponseSchema.parse({
                totalEvents: journal.events.length,
                lastDigestAt: journal.lastDigestAt,
              })
              break
            }
            const before = parsedUrl.searchParams.get('before')
            const limit = parsedUrl.searchParams.get('limit')
            const events = before
              ? journal.events.filter((event) => event.timestamp < before)
              : journal.events
            payload = BackendJournalResponseSchema.parse({
              ...journal,
              events: limit ? events.slice(0, Number(limit)) : events,
            })
            break
          }
          case BACKEND_ANOMALIES_ROUTE:
            payload = BackendAnomaliesResponseSchema.parse(
              await resolved.projectService.getAnomalies(project),
            )
            break
        }
        writeJson(response, 200, payload)
        return
      } catch (error) {
        if (error instanceof BackendProjectServiceError) {
          if (error.code === 'INVALID_RESOURCE') {
            writeError(response, 422, 'BAD_REQUEST', 'Backend Project resource is invalid')
          } else {
            writeError(response, 404, 'NOT_FOUND', 'Backend Project resource not found')
          }
          return
        }
        writeError(response, 500, 'INTERNAL', 'Backend Project read failed')
        return
      }
    }

    if (isWikiReviewRoute(route.key)) {
      const project = selectedProject(parsedUrl.searchParams)
      if (!project || !resolved.documentService) {
        writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
        return
      }
      try {
        const actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
        // Shell class: verification is an owner judgement, never a viewer's.
        const authorization = authorizeBackendActor({
          actor,
          target: { host: resolved.host, project },
          routeClass: 'shell',
        })
        if (!authorization.ok) {
          writeError(response, 403, 'FORBIDDEN', authorization.message)
          return
        }
        if (route.key === BACKEND_WIKI_REVIEW_ROUTE) {
          writeJson(
            response,
            200,
            BackendWikiReviewResponseSchema.parse(
              await resolved.documentService.wikiReviewLog(project),
            ),
          )
          return
        }
        if (!route.wikiSha) {
          writeError(response, 400, 'BAD_REQUEST', 'commit sha is required')
          return
        }
        let note: string | undefined
        if (method === 'POST' && request.headers['content-type'] !== undefined) {
          note = BackendWikiReviewMarkRequestSchema.parse(
            await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES),
          ).note
        }
        const log =
          method === 'POST'
            ? await resolved.documentService.markWikiReview(project, route.wikiSha, note)
            : await resolved.documentService.unmarkWikiReview(project, route.wikiSha)
        writeJson(response, 200, BackendWikiReviewResponseSchema.parse(log))
        resolved.eventStream.publish({ project, topic: 'wiki-review-change', data: {} })
        resolved.eventStream.publish({
          project,
          topic: 'wiki-change',
          data: { type: 'review' },
        })
        return
      } catch (error) {
        if (error instanceof WikiReviewOrderError) {
          writeJson(
            response,
            409,
            BackendWikiReviewOrderResponseSchema.parse({
              error: { code: 'REVIEW_ORDER', message: error.message },
              nextSha: error.nextSha,
            }),
          )
          return
        }
        if (error instanceof WikiReviewError) {
          writeError(response, 404, 'NOT_FOUND', 'Backend wiki review is unavailable')
          return
        }
        if (error instanceof BackendDocumentServiceError) {
          writeError(
            response,
            error.code === 'INVALID_RESOURCE' ? 400 : 404,
            error.code === 'INVALID_RESOURCE' ? 'BAD_REQUEST' : 'NOT_FOUND',
            error.message,
          )
          return
        }
        if (error instanceof BackendControlBodyError) {
          writeError(response, error.status, error.code, error.message)
          return
        }
        if (error instanceof BackendActorContextError) {
          writeError(
            response,
            error.status,
            error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
            error.message,
          )
          return
        }
        writeError(response, 400, 'BAD_REQUEST', 'Backend wiki review request is invalid')
        return
      }
    }

    if (isDocumentDataRoute(route.key)) {
      const project = selectedProject(parsedUrl.searchParams)
      const needsProjectService =
        route.key === BACKEND_RUN_README_ROUTE || route.key === BACKEND_EXPERIMENT_README_ROUTE
      if (
        !project ||
        !resolved.documentService ||
        (needsProjectService && !resolved.projectService) ||
        (needsProjectService && method === 'PUT' && !resolved.mutationService)
      ) {
        writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
        return
      }
      let actor: ReturnType<typeof decodeBackendActorContext>
      try {
        actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
      } catch (error) {
        if (error instanceof BackendActorContextError) {
          writeError(
            response,
            error.status,
            error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
            error.message,
          )
          return
        }
        throw error
      }
      const authorization = authorizeBackendActor({
        actor,
        target: { host: resolved.host, project },
        routeClass: method === 'GET' ? 'read' : 'mutating',
      })
      if (!authorization.ok) {
        writeError(response, 403, 'FORBIDDEN', authorization.message)
        return
      }

      try {
        switch (route.key) {
          case BACKEND_REPORTS_ROUTE:
            writeJson(
              response,
              200,
              BackendReportsResponseSchema.parse(
                await resolved.documentService.listReports(project),
              ),
            )
            return
          case BACKEND_REPORT_ROUTE:
            if (!route.resourceId) throw new BackendDocumentServiceError('RESOURCE_NOT_FOUND', '')
            if (method === 'GET') {
              writeJson(
                response,
                200,
                BackendReportResponseSchema.parse(
                  await resolved.documentService.getReport(project, route.resourceId),
                ),
              )
              return
            }
            if (
              writeDocumentResult(
                response,
                await resolved.documentService.putReport(
                  project,
                  route.resourceId,
                  await readDocumentWriteRequest(request),
                ),
              )
            ) {
              resolved.eventStream.publish({
                project,
                topic: 'reports-change',
                data: { type: 'set', id: route.resourceId },
              })
            }
            return
          case BACKEND_DIGESTS_ROUTE:
            writeJson(
              response,
              200,
              BackendDigestsResponseSchema.parse(
                await resolved.documentService.listDigests(project),
              ),
            )
            return
          case BACKEND_DIGEST_ROUTE:
            if (!route.resourceId) throw new BackendDocumentServiceError('RESOURCE_NOT_FOUND', '')
            if (method === 'GET') {
              writeJson(
                response,
                200,
                BackendDigestResponseSchema.parse(
                  await resolved.documentService.getDigest(project, route.resourceId),
                ),
              )
              return
            }
            if (
              writeDocumentResult(
                response,
                await resolved.documentService.putDigest(
                  project,
                  route.resourceId,
                  await readDocumentWriteRequest(request),
                ),
              )
            ) {
              resolved.eventStream.publish({
                project,
                topic: 'digests-change',
                data: { type: 'set', id: route.resourceId },
              })
            }
            return
          case BACKEND_CODE_REVIEWS_ROUTE:
            writeJson(
              response,
              200,
              BackendCodeReviewsResponseSchema.parse(
                await resolved.documentService.listCodeReviews(project),
              ),
            )
            return
          case BACKEND_CODE_REVIEW_ROUTE:
            if (!route.resourceId) throw new BackendDocumentServiceError('RESOURCE_NOT_FOUND', '')
            if (method === 'GET') {
              writeJson(
                response,
                200,
                BackendCodeReviewResponseSchema.parse(
                  await resolved.documentService.getCodeReview(project, route.resourceId),
                ),
              )
              return
            }
            if (
              writeCodeReviewResult(
                response,
                await resolved.documentService.patchCodeReview(
                  project,
                  route.resourceId,
                  await readCodeReviewPatchRequest(request),
                ),
              )
            ) {
              resolved.eventStream.publish({
                project,
                topic: 'code-reviews-change',
                data: { type: 'set', id: route.resourceId },
              })
            }
            return
          case BACKEND_README_ROUTE: {
            const resource = selectedReadmeResource(parsedUrl.searchParams)
            if (!resource) throw new BackendDocumentServiceError('INVALID_RESOURCE', '')
            if (method === 'GET') {
              writeJson(
                response,
                200,
                BackendReadmeResponseSchema.parse(
                  await resolved.documentService.getReadme(project, resource),
                ),
              )
              return
            }
            if (
              writeDocumentResult(
                response,
                await resolved.documentService.putReadme(
                  project,
                  resource,
                  await readDocumentWriteRequest(request),
                ),
              )
            ) {
              const run = /^logs\/([^/]+)\/README\.md$/.exec(resource)
              const experiment = /^docs\/experiments\/([^/]+)\/README\.md$/.exec(resource)
              if (run?.[1]) {
                resolved.eventStream.publish({
                  project,
                  topic: 'run-change',
                  data: { type: 'set', id: run[1] },
                })
              } else if (experiment?.[1]) {
                resolved.eventStream.publish({
                  project,
                  topic: 'experiment-change',
                  data: { type: 'set', id: experiment[1] },
                })
              }
            }
            return
          }
          case BACKEND_RUN_README_ROUTE:
          case BACKEND_EXPERIMENT_README_ROUTE: {
            if (!route.resourceId || !resolved.projectService) {
              throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', '')
            }
            const detail =
              route.key === BACKEND_RUN_README_ROUTE
                ? BackendRunResponseSchema.parse(
                    await resolved.projectService.getRun(project, route.resourceId),
                  )
                : BackendExperimentResponseSchema.parse(
                    await resolved.projectService.getExperiment(project, route.resourceId),
                  )
            if (method === 'GET') {
              writeJson(
                response,
                200,
                BackendReadmeResponseSchema.parse(
                  await resolved.documentService.getReadme(project, detail.resource),
                ),
              )
              return
            }
            const input = BackendDocumentWriteRequestSchema.parse(
              await readBoundedJsonRequest(request, MAX_BACKEND_DOCUMENT_BODY_BYTES),
            )
            const mutationResult =
              route.key === BACKEND_RUN_README_ROUTE
                ? await resolved.mutationService!.writeRunReadme(project, route.resourceId, input)
                : await resolved.mutationService!.writeExperimentReadme(
                    project,
                    route.resourceId,
                    input,
                  )
            const { journalChanged, ...publicResult } = mutationResult
            const result = BackendReadmeMutationResponseSchema.parse(publicResult)
            writeJson(response, 200, result)
            resolved.eventStream.publish({
              project,
              topic: route.key === BACKEND_RUN_README_ROUTE ? 'run-change' : 'experiment-change',
              data: { type: 'set', id: route.resourceId },
            })
            if (journalChanged) publishJournalChange(resolved.eventStream, project)
            return
          }
          case BACKEND_WIKI_ROUTE:
            writeJson(
              response,
              200,
              BackendWikiPagesResponseSchema.parse(
                await resolved.documentService.listWiki(project),
              ),
            )
            return
          case BACKEND_WIKI_BACKLINKS_ROUTE:
            if (!route.wikiArtifact) {
              throw new BackendDocumentServiceError('INVALID_RESOURCE', '')
            }
            writeJson(
              response,
              200,
              BackendWikiBacklinksResponseSchema.parse({
                artifact: route.wikiArtifact,
                pages: await resolved.documentService.wikiBacklinks(project, route.wikiArtifact),
              }),
            )
            return
          case BACKEND_WIKI_PAGE_ROUTE: {
            if (!route.wikiId) throw new BackendDocumentServiceError('INVALID_RESOURCE', '')
            if (method === 'GET') {
              writeJson(
                response,
                200,
                BackendWikiDocumentSchema.parse(
                  await resolved.documentService.getWiki(project, route.wikiId),
                ),
              )
              return
            }
            const result = await resolved.documentService.putWiki(
              project,
              route.wikiId,
              await readDocumentWriteRequest(request),
            )
            const conflict = BackendWikiConflictResponseSchema.safeParse(result)
            if (conflict.success) {
              writeJson(response, 409, conflict.data)
              return
            }
            writeJson(response, 200, BackendWikiWriteResponseSchema.parse(result))
            resolved.eventStream.publish({
              project,
              topic: 'wiki-change',
              data: { type: 'set', id: route.wikiId },
            })
            return
          }
        }
      } catch (error) {
        if (error instanceof BackendControlBodyError) {
          writeError(response, error.status, error.code, error.message)
          return
        }
        if (error instanceof BackendDocumentServiceError) {
          if (error.code === 'INVALID_RESOURCE') {
            writeError(response, 400, 'BAD_REQUEST', 'Backend document resource is invalid')
          } else if (error.code === 'AMBIGUOUS_RESOURCE') {
            writeError(response, 409, 'CONFLICT', 'Backend document resource is ambiguous')
          } else {
            writeError(response, 404, 'NOT_FOUND', 'Backend document resource not found')
          }
          return
        }
        if (error instanceof BackendMutationError) {
          if (error.code === 'CONFLICT') {
            writeJson(
              response,
              409,
              BackendDocumentConflictResponseSchema.parse({
                error: { code: 'CONFLICT', message: error.message },
                currentMtime: error.current?.mtime,
                currentHash: error.current?.hash,
              }),
            )
            return
          }
          const status = mutationErrorStatus(error)
          writeError(
            response,
            status,
            status === 400
              ? 'BAD_REQUEST'
              : status === 403
                ? 'FORBIDDEN'
                : status === 404
                  ? 'NOT_FOUND'
                  : 'INTERNAL',
            status >= 500 ? 'Backend README mutation failed' : error.message,
          )
          return
        }
        if (error instanceof BackendProjectServiceError) {
          writeError(response, 404, 'NOT_FOUND', 'Backend README resource not found')
          return
        }
        writeError(response, 500, 'INTERNAL', 'Backend document operation failed')
        return
      }
    }

    if (isGitDataRoute(route.key)) {
      const project = route.project ?? selectedProject(parsedUrl.searchParams)
      if (
        !project ||
        !resolved.gitService ||
        !resolved.capabilities.git ||
        (method !== 'GET' && !resolved.capabilities.mutations)
      ) {
        writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
        return
      }
      let actor: ReturnType<typeof decodeBackendActorContext>
      try {
        actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
      } catch (error) {
        if (error instanceof BackendActorContextError) {
          writeError(
            response,
            error.status,
            error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
            error.message,
          )
          return
        }
        throw error
      }
      const authorization = authorizeBackendActor({
        actor,
        target: { host: resolved.host, project },
        routeClass: method === 'GET' ? 'read' : 'mutating',
      })
      if (!authorization.ok) {
        writeError(response, 403, 'FORBIDDEN', authorization.message)
        return
      }

      const submodule = parsedUrl.searchParams.get('submodule') ?? undefined
      try {
        switch (route.key) {
          case BACKEND_GIT_STATUS_ROUTE:
            writeJson(
              response,
              200,
              BackendGitStatusResponseSchema.parse(await resolved.gitService.status(project)),
            )
            return
          case BACKEND_GIT_STATUS_FILES_ROUTE:
            writeJson(
              response,
              200,
              BackendGitStatusFilesResponseSchema.parse(
                await resolved.gitService.statusFiles(project, { submodule }),
              ),
            )
            return
          case BACKEND_GIT_BRANCHES_ROUTE:
            writeJson(
              response,
              200,
              BackendGitBranchesResponseSchema.parse(
                await resolved.gitService.branches(project, { submodule }),
              ),
            )
            return
          case BACKEND_GIT_LOG_ROUTE:
            writeJson(
              response,
              200,
              BackendGitLogResponseSchema.parse(
                await resolved.gitService.log(project, {
                  ref: parsedUrl.searchParams.get('ref')!,
                  limit: Number(parsedUrl.searchParams.get('limit') ?? 100),
                  submodule,
                }),
              ),
            )
            return
          case BACKEND_GIT_COMMIT_ROUTE:
            writeJson(
              response,
              200,
              BackendGitCommitResponseSchema.parse(
                await resolved.gitService.commit(project, parsedUrl.searchParams.get('sha')!, {
                  submodule,
                }),
              ),
            )
            return
          case BACKEND_GIT_RANGE_ROUTE:
            writeJson(
              response,
              200,
              BackendGitRangeResponseSchema.parse(
                await resolved.gitService.range(project, {
                  from: parsedUrl.searchParams.get('from')!,
                  to: parsedUrl.searchParams.get('to')!,
                  submodule,
                }),
              ),
            )
            return
          case BACKEND_GIT_DIFF_ROUTE:
            writeJson(
              response,
              200,
              BackendGitDiffResponseSchema.parse(
                await resolved.gitService.diff(project, {
                  path: parsedUrl.searchParams.get('path')!,
                  side: parsedUrl.searchParams.get('side') as
                    | 'staged'
                    | 'unstaged'
                    | 'untracked'
                    | 'commit'
                    | 'range',
                  ...(parsedUrl.searchParams.get('sha')
                    ? { sha: parsedUrl.searchParams.get('sha')! }
                    : {}),
                  ...(parsedUrl.searchParams.get('from')
                    ? { from: parsedUrl.searchParams.get('from')! }
                    : {}),
                  ...(parsedUrl.searchParams.get('to')
                    ? { to: parsedUrl.searchParams.get('to')! }
                    : {}),
                  submodule,
                }),
              ),
              5 * 1024 * 1024,
            )
            return
          case BACKEND_GIT_SUBMODULES_ROUTE:
            writeJson(
              response,
              200,
              BackendGitSubmodulesResponseSchema.parse(
                await resolved.gitService.submodules(project),
              ),
            )
            return
          case BACKEND_CODE_PREVIEW_ROUTE:
            writeJson(
              response,
              200,
              BackendCodePreviewResponseSchema.parse(
                await resolved.gitService.codePreview(project, parsedUrl.searchParams.get('url')!),
              ),
            )
            return
          case BACKEND_GIT_COMMIT_MARKS_ROUTE:
            writeJson(
              response,
              200,
              BackendCommitMarksResponseSchema.parse(
                await resolved.gitService.commitMarks(project),
              ),
            )
            return
          case BACKEND_GIT_COMMIT_MARK_ROUTE:
            if (!route.gitRef) throw new BackendGitServiceError('INVALID_RESOURCE', '')
            if (method === 'PUT') {
              writeJson(
                response,
                200,
                BackendCommitMarkWriteResponseSchema.parse(
                  await resolved.gitService.setCommitMark(project, route.gitRef, {
                    ...(await readCommitMarkWriteRequest(request)),
                    submodule,
                  }),
                ),
              )
              return
            }
            writeJson(
              response,
              200,
              BackendCommitMarkDeleteResponseSchema.parse(
                await resolved.gitService.deleteCommitMark(project, route.gitRef, { submodule }),
              ),
            )
            return
        }
      } catch (error) {
        if (error instanceof BackendControlBodyError) {
          writeError(response, error.status, error.code, error.message)
          return
        }
        if (error instanceof BackendGitServiceError) {
          if (error.code === 'INVALID_RESOURCE') {
            writeError(response, 400, 'BAD_REQUEST', 'Backend Git resource is invalid')
          } else {
            writeError(response, 404, 'NOT_FOUND', 'Backend Git resource not found')
          }
          return
        }
        writeError(response, 500, 'INTERNAL', 'Backend Git operation failed')
        return
      }
    }

    if (
      (route.key === BACKEND_SHARES_ROUTE || route.key === BACKEND_SHARE_ITEM_ROUTE) &&
      route.project
    ) {
      if (!resolved.capabilities.shares) {
        writeError(response, 404, 'UNSUPPORTED_CAPABILITY', 'Share service is unavailable')
        return
      }
      let actor: ReturnType<typeof decodeBackendActorContext>
      try {
        actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
      } catch (error) {
        if (error instanceof BackendActorContextError) {
          writeError(
            response,
            error.status,
            error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
            error.message,
          )
          return
        }
        throw error
      }
      const target = { host: resolved.host, project: route.project }
      const authorization = authorizeBackendActor({ actor, target, routeClass: 'mutating' })
      if (!authorization.ok) {
        writeError(response, 403, 'FORBIDDEN', authorization.message)
        return
      }

      try {
        if (route.key === BACKEND_SHARES_ROUTE && method === 'GET') {
          const reveal = parsedUrl.searchParams.get('reveal') === 'true'
          const records = await resolved.shareProviders.list(route.project, reveal)
          const parsed = BackendShareListResponseSchema.safeParse({ shares: records })
          if (!parsed.success) throw new Error('invalid share-list provider response')
          const shares = reveal
            ? parsed.data.shares
            : parsed.data.shares.map((record) => ({ ...record, token: '' }))
          writeJson(response, 200, BackendShareListResponseSchema.parse({ shares }))
          return
        }

        if (route.key === BACKEND_SHARES_ROUTE && method === 'POST') {
          const rawBody = await readBoundedJsonRequest(
            request,
            MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES,
          )
          const body = BackendShareCreateRequestSchema.safeParse(rawBody)
          if (!body.success) {
            throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Share create request is invalid')
          }
          const record = await resolved.shareProviders.add(route.project, body.data)
          const payload = BackendShareCreateResponseSchema.safeParse({ share: record })
          if (!payload.success) throw new Error('invalid share-add provider response')
          writeJson(response, 201, payload.data)
          return
        }

        if (route.key === BACKEND_SHARE_ITEM_ROUTE && method === 'DELETE' && route.shareId) {
          const records = await resolved.shareProviders.revoke(route.project, route.shareId)
          const payload = BackendShareRevokeResponseSchema.safeParse({ revoked: records })
          if (!payload.success) throw new Error('invalid share-revoke provider response')
          writeJson(response, 200, payload.data)
          return
        }
      } catch (error) {
        if (error instanceof BackendControlBodyError) {
          writeError(response, error.status, error.code, error.message)
          return
        }
        if (error instanceof ShareNotFoundError) {
          writeError(response, 404, 'NOT_FOUND', 'Share record not found')
          return
        }
        if (error instanceof AmbiguousShareError) {
          writeError(response, 409, 'CONFLICT', 'Share record selection is ambiguous')
          return
        }
        writeError(response, 503, 'UNAVAILABLE', 'Backend share operation failed', true)
        return
      }
    }

    if (route.key === BACKEND_SHARE_VALIDATE_ROUTE && route.project) {
      let actor: ReturnType<typeof decodeBackendActorContext>
      try {
        actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
      } catch (error) {
        if (error instanceof BackendActorContextError) {
          writeError(
            response,
            error.status,
            error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
            error.message,
          )
          return
        }
        throw error
      }
      const target = { host: resolved.host, project: route.project }
      const authorization = authorizeBackendActor({ actor, target, routeClass: 'mutating' })
      if (!authorization.ok) {
        writeError(response, 403, 'FORBIDDEN', authorization.message)
        return
      }

      let body: ReturnType<typeof BackendShareValidationRequestSchema.parse>
      try {
        const rawBody = await readBoundedJsonRequest(
          request,
          MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES,
        )
        const parsedBody = BackendShareValidationRequestSchema.safeParse(rawBody)
        if (!parsedBody.success) {
          throw new BackendControlBodyError(
            400,
            'BAD_REQUEST',
            'Share validation request is invalid',
          )
        }
        body = parsedBody.data
      } catch (error) {
        if (error instanceof BackendControlBodyError) {
          writeError(response, error.status, error.code, error.message)
          return
        }
        throw error
      }

      let valid: boolean
      try {
        valid = await resolved.shareValidator(route.project, body.token)
      } catch {
        writeError(response, 503, 'UNAVAILABLE', 'Backend share validation failed', true)
        return
      }
      const payload = BackendShareValidationResponseSchema.parse({ valid: valid === true })
      writeJson(response, 200, payload)
      return
    }

    let ready: boolean
    try {
      ready = await resolved.readiness()
    } catch {
      writeError(response, 503, 'UNAVAILABLE', 'Backend readiness check failed', true)
      return
    }

    const metadata = BackendMetadataSchema.parse({
      host: resolved.host,
      release: resolved.release,
      apiMajor: BACKEND_API_MAJOR,
      revision: resolved.revision,
      instanceEpoch: resolved.instanceEpoch,
      ready,
      capabilities: resolved.capabilities,
    })
    writeJson(response, 200, metadata)
  }
}

interface BackendTerminalProxyRoute {
  opaqueRoute: string
}

function resolveBackendTerminalProxyRoute(requestTarget: string): BackendTerminalProxyRoute | null {
  let parsed: URL
  try {
    parsed = new URL(requestTarget, 'http://backend.invalid')
  } catch {
    return null
  }
  const rawPath = rawOriginFormPath(requestTarget)
  if (
    rawPath === null ||
    rawPath !== parsed.pathname ||
    !rawPath.startsWith(BACKEND_TERMINAL_PROXY_PREFIX)
  ) {
    return null
  }
  const routeSegment = rawPath.slice(BACKEND_TERMINAL_PROXY_PREFIX.length).split('/', 1)[0]
  if (!routeSegment) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(routeSegment)
  } catch {
    return null
  }
  if (decoded !== routeSegment) return null
  const route = TerminalSessionIdSchema.safeParse(decoded)
  return route.success ? { opaqueRoute: route.data } : null
}

function terminalRequestStatus(
  request: IncomingMessage,
  resolved: ResolvedBackendOptions,
): { status: 400 | 401 | 403; code: BackendErrorCode; message: string } | null {
  if (!authenticates(request, resolved.serviceTokens)) {
    return {
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Backend service authentication failed',
    }
  }
  if (resolved.readOnly) {
    return { status: 403, code: 'FORBIDDEN', message: 'Backend is configured read-only' }
  }
  let actor: ReturnType<typeof decodeBackendActorContext>
  try {
    actor = decodeBackendActorContext({
      serviceAuthenticated: true,
      headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
    })
  } catch (error) {
    if (error instanceof BackendActorContextError) {
      return {
        status: error.status,
        code: error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
        message: error.message,
      }
    }
    throw error
  }
  return actor.role === 'owner'
    ? null
    : {
        status: 403,
        code: 'FORBIDDEN',
        message: 'owner actor is required for Backend terminal relay',
      }
}

function normalizeTerminalTarget(input: string | null): string | null {
  if (!input) return null
  const exact = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(input)
  if (!exact) return null
  const port = Number(exact[1])
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null
  let target: URL
  try {
    target = new URL(input)
  } catch {
    return null
  }
  if (
    target.protocol !== 'http:' ||
    target.hostname !== '127.0.0.1' ||
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search !== '' ||
    target.hash !== ''
  ) {
    return null
  }
  return `http://127.0.0.1:${port}`
}

function safeTerminalTailSegment(segment: string, isFinal: boolean): boolean {
  if (segment.length === 0) return isFinal
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return false
  }
  return (
    decoded !== '.' &&
    decoded !== '..' &&
    !decoded.includes('/') &&
    !decoded.includes('\\') &&
    !decoded.includes('\0')
  )
}

function terminalForwardTarget(
  request: IncomingMessage,
  route: BackendTerminalProxyRoute,
  resolved: ResolvedBackendOptions,
): string | null {
  const forwarded = request.headers[BACKEND_TERMINAL_PUBLIC_PATH_HEADER]
  if (forwarded === undefined) return request.url ?? null
  if (
    typeof forwarded !== 'string' ||
    forwarded.length === 0 ||
    Buffer.byteLength(forwarded, 'utf8') > 16 * 1024 ||
    forwarded.includes('#')
  ) {
    return null
  }
  const rawPath = rawOriginFormPath(forwarded)
  if (!rawPath?.startsWith(CENTRAL_TERMINAL_PROXY_PREFIX)) return null
  let parsed: URL
  try {
    parsed = new URL(forwarded, 'http://central.invalid')
  } catch {
    return null
  }
  if (rawPath !== parsed.pathname) return null
  const segments = rawPath.slice(CENTRAL_TERMINAL_PROXY_PREFIX.length).split('/')
  const host = segments[0]
  const session = segments[1]
  let decodedHost: string
  let decodedSession: string
  try {
    decodedHost = decodeURIComponent(host ?? '')
    decodedSession = decodeURIComponent(session ?? '')
  } catch {
    return null
  }
  if (
    !host ||
    !session ||
    decodedHost !== host ||
    decodedSession !== session ||
    host !== resolved.host ||
    session !== route.opaqueRoute
  ) {
    return null
  }
  const tail = segments.slice(2)
  return tail.every((segment, index) => safeTerminalTailSegment(segment, index === tail.length - 1))
    ? forwarded
    : null
}

function stripTerminalProxyCredentials(request: IncomingMessage): void {
  for (const name of Object.keys(request.headers)) {
    const lower = name.toLowerCase()
    if (
      lower === 'authorization' ||
      lower === 'cookie' ||
      lower === 'proxy-authorization' ||
      lower === 'origin' ||
      lower === 'forwarded' ||
      lower.startsWith('x-forwarded-') ||
      lower.startsWith('x-memon-')
    ) {
      delete request.headers[name]
    }
  }
}

function reportTerminalProxyError(resolved: ResolvedBackendOptions, error: unknown): void {
  try {
    resolved.onTerminalProxyError?.(error instanceof Error ? error : new Error(String(error)))
  } catch {
    // Diagnostics must never replace the bounded relay error returned to the caller.
  }
}

async function terminalTarget(
  route: BackendTerminalProxyRoute,
  resolved: ResolvedBackendOptions,
): Promise<string | null> {
  if (!resolved.capabilities.terminal || !resolved.terminalTargetResolver) return null
  try {
    return normalizeTerminalTarget(await resolved.terminalTargetResolver(route.opaqueRoute))
  } catch (error) {
    reportTerminalProxyError(resolved, error)
    return null
  }
}

function rejectTerminalUpgrade(socket: Duplex, status: 400 | 401 | 403 | 404 | 405 | 502): void {
  const reason =
    status === 400
      ? 'Bad Request'
      : status === 401
        ? 'Unauthorized'
        : status === 403
          ? 'Forbidden'
          : status === 404
            ? 'Not Found'
            : status === 405
              ? 'Method Not Allowed'
              : 'Bad Gateway'
  const body = JSON.stringify({ error: { code: status === 502 ? 'UNAVAILABLE' : 'FORBIDDEN' } })
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  )
  socket.destroy()
}

/** Create the independently runnable Node HTTP server without Next/Web code. */
export function createBackendServer(options: BackendServerOptions): Server {
  const resolved = resolveOptions(options)
  const handler = createResolvedBackendHandler(resolved)
  const proxy = createProxyServer({ ws: true, changeOrigin: true })
  proxy.on('proxyReqWs', (proxyRequest, _request, downstreamSocket) => {
    let upstreamSocket: Duplex | null = null
    const onDownstreamClose = () => upstreamSocket?.destroy()
    downstreamSocket.once('close', onDownstreamClose)
    downstreamSocket.once('end', onDownstreamClose)
    downstreamSocket.once('error', onDownstreamClose)
    proxyRequest.once('upgrade', (_response, socket) => {
      upstreamSocket = socket
      if (downstreamSocket.destroyed) {
        socket.destroy()
        return
      }
      const onUpstreamClose = () => {
        downstreamSocket.off('close', onDownstreamClose)
        downstreamSocket.off('end', onDownstreamClose)
        downstreamSocket.off('error', onDownstreamClose)
        if (!downstreamSocket.destroyed) downstreamSocket.destroy()
      }
      socket.once('close', onUpstreamClose)
      socket.once('end', onUpstreamClose)
      socket.once('error', onUpstreamClose)
    })
  })
  proxy.on('error', (error, _request, responseOrSocket) => {
    reportTerminalProxyError(resolved, error)
    if (responseOrSocket && typeof (responseOrSocket as ServerResponse).writeHead === 'function') {
      const response = responseOrSocket as ServerResponse
      if (response.headersSent) response.destroy()
      else writeError(response, 502, 'UNAVAILABLE', 'Backend terminal route is unavailable', true)
      return
    }
    if (responseOrSocket) rejectTerminalUpgrade(responseOrSocket as Duplex, 502)
  })

  const server = createServer((request, response) => {
    if (
      resolved.terminalTargetResolver &&
      rawOriginFormPath(request.url ?? '')?.startsWith(BACKEND_TERMINAL_PROXY_PREFIX)
    ) {
      void (async () => {
        const denied = terminalRequestStatus(request, resolved)
        if (denied) {
          writeError(response, denied.status, denied.code, denied.message)
          return
        }
        if (request.method !== 'GET') {
          response.setHeader('allow', 'GET')
          writeError(response, 405, 'METHOD_NOT_ALLOWED', 'method not allowed')
          return
        }
        const route = resolveBackendTerminalProxyRoute(request.url ?? '')
        if (!route) {
          writeError(response, 404, 'NOT_FOUND', 'Backend terminal route not found')
          return
        }
        const forwardTarget = terminalForwardTarget(request, route, resolved)
        if (!forwardTarget) {
          writeError(response, 400, 'BAD_REQUEST', 'Backend terminal forward path is invalid')
          return
        }
        const target = await terminalTarget(route, resolved)
        if (!target) {
          writeError(response, 502, 'UNAVAILABLE', 'Backend terminal route is unavailable', true)
          return
        }
        resolved.terminalService?.noteHttpActivity?.(route.opaqueRoute)
        stripTerminalProxyCredentials(request)
        request.url = forwardTarget
        proxy.web(request, response, { target })
      })().catch(() => {
        if (response.headersSent) response.destroy()
        else writeError(response, 500, 'INTERNAL', 'Backend terminal relay failed')
      })
      return
    }
    void handler(request, response).catch(() => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      writeError(response, 500, 'INTERNAL', 'Backend request failed')
    })
  })
  server.on('upgrade', (request, socket, head) => {
    if (
      !resolved.terminalTargetResolver ||
      !rawOriginFormPath(request.url ?? '')?.startsWith(BACKEND_TERMINAL_PROXY_PREFIX)
    ) {
      socket.destroy()
      return
    }
    void (async () => {
      const denied = terminalRequestStatus(request, resolved)
      if (denied) {
        rejectTerminalUpgrade(socket, denied.status)
        return
      }
      if (request.method !== 'GET') {
        rejectTerminalUpgrade(socket, 405)
        return
      }
      const route = resolveBackendTerminalProxyRoute(request.url ?? '')
      if (!route) {
        rejectTerminalUpgrade(socket, 404)
        return
      }
      const forwardTarget = terminalForwardTarget(request, route, resolved)
      if (!forwardTarget) {
        rejectTerminalUpgrade(socket, 400)
        return
      }
      const target = await terminalTarget(route, resolved)
      if (!target) {
        rejectTerminalUpgrade(socket, 502)
        return
      }
      resolved.terminalService?.noteWsConnect?.(route.opaqueRoute)
      socket.once('close', () => resolved.terminalService?.noteWsDisconnect?.(route.opaqueRoute))
      stripTerminalProxyCredentials(request)
      request.url = forwardTarget
      proxy.ws(request, socket, head, { target })
    })().catch(() => rejectTerminalUpgrade(socket, 502))
  })
  server.once('close', () => {
    proxy.close()
    resolved.filesystemMonitor?.stop()
    resolved.eventStream.close()
    resolved.terminalService?.close?.()
  })
  return server
}
