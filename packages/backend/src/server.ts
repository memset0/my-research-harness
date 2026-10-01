import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { TextDecoder } from 'node:util'
import {
  AmbiguousShareError,
  BACKEND_API_MAJOR,
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
  BackendGitStatusFilesResponseSchema,
  BackendGitStatusResponseSchema,
  BackendGitSubmodulesResponseSchema,
  BackendHypothesesResponseSchema,
  BackendJournalCountResponseSchema,
  BackendJournalHistoryResponseSchema,
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
  BackendResourceInventoryResponseSchema,
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
  BackendWarningMutationRequestSchema,
  BackendWarningMutationResponseSchema,
  BackendWarningsResponseSchema,
  BackendWikiBacklinksResponseSchema,
  BackendWikiConflictResponseSchema,
  BackendWikiDocumentSchema,
  BackendWikiInventoryResponseSchema,
  BackendWikiPagesResponseSchema,
  BackendWikiReviewMarkRequestSchema,
  BackendWikiReviewOrderResponseSchema,
  BackendWikiReviewResponseSchema,
  BackendWikiWriteResponseSchema,
  HostIdSchema,
  InstanceEpochSchema,
  JournalRecordingError,
  MEMON_RELEASE,
  MEMON_REVISION,
  ProjectNameSchema,
  ReleaseVersionSchema,
  ResourceIdSchema,
  RevisionSchema,
  ShareNotFoundError,
  WikiReviewError,
  WikiReviewOrderError,
} from '@memon/core'
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
import {
  BACKEND_ANOMALIES_ROUTE,
  BACKEND_API_PREFIX,
  BACKEND_CODE_PREVIEW_ROUTE,
  BACKEND_CODE_REVIEW_ROUTE,
  BACKEND_CODE_REVIEWS_ROUTE,
  BACKEND_EVENTS_PATH,
  BACKEND_EXPERIMENT_ARCHIVE_ROUTE,
  BACKEND_EXPERIMENT_LINK_ROUTE,
  BACKEND_EXPERIMENT_README_ROUTE,
  BACKEND_EXPERIMENT_RESULTS_ROUTE,
  BACKEND_EXPERIMENT_ROUTE,
  BACKEND_EXPERIMENT_STATUS_ROUTE,
  BACKEND_EXPERIMENT_UNLINK_ROUTE,
  BACKEND_EXPERIMENT_WARNING_ROUTE,
  BACKEND_EXPERIMENT_WARNINGS_ROUTE,
  BACKEND_EXPERIMENTS_ROUTE,
  BACKEND_GIT_BRANCHES_ROUTE,
  BACKEND_GIT_COMMIT_MARK_ROUTE,
  BACKEND_GIT_COMMIT_MARKS_ROUTE,
  BACKEND_GIT_COMMIT_ROUTE,
  BACKEND_GIT_DIFF_ROUTE,
  BACKEND_GIT_LOG_ROUTE,
  BACKEND_GIT_RANGE_ROUTE,
  BACKEND_GIT_STATUS_FILES_ROUTE,
  BACKEND_GIT_STATUS_ROUTE,
  BACKEND_GIT_SUBMODULES_ROUTE,
  BACKEND_HYPOTHESES_ROUTE,
  BACKEND_JOURNAL_HISTORY_ROUTE,
  BACKEND_JOURNAL_ROUTE,
  BACKEND_LOG_FILES_ROUTE,
  BACKEND_LOG_ROUTE,
  BACKEND_LOG_STREAM_ROUTE,
  BACKEND_PROJECTS_PATH,
  BACKEND_README_ROUTE,
  BACKEND_REPORT_ASSET_ROUTE,
  BACKEND_REPORT_ROUTE,
  BACKEND_REPORTS_ROUTE,
  BACKEND_RUN_ARCHIVE_ROUTE,
  BACKEND_RUN_FILES_ROUTE,
  BACKEND_RUN_README_ROUTE,
  BACKEND_RUN_ROUTE,
  BACKEND_RUN_STATUS_ROUTE,
  BACKEND_RUN_WARNING_ROUTE,
  BACKEND_RUN_WARNINGS_ROUTE,
  BACKEND_RUNS_ROUTE,
  BACKEND_SHARE_ITEM_ROUTE,
  BACKEND_SHARE_VALIDATE_ROUTE,
  BACKEND_SHARES_ROUTE,
  BACKEND_SLURM_STATUS_ROUTE,
  BACKEND_WIKI_ASSET_ROUTE,
  BACKEND_WIKI_BACKLINKS_ROUTE,
  BACKEND_WIKI_PAGE_ROUTE,
  BACKEND_WIKI_REVIEW_MARK_ROUTE,
  BACKEND_WIKI_REVIEW_ROUTE,
  BACKEND_WIKI_ROUTE,
  MAX_BACKEND_CONTROL_JSON_BYTES,
  MAX_BACKEND_DOCUMENT_BODY_BYTES,
  MAX_BACKEND_GIT_CONTROL_BODY_BYTES,
  MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES,
} from './http/paths.js'
import {
  isDocumentDataRoute,
  isGitDataRoute,
  isProjectDataRoute,
  isStreamDataRoute,
  isWikiReviewRoute,
  resolveAllowedBackendRoute,
  routeAllowsQuery,
} from './legacy-routes.js'
import { BackendMutationError, type BackendMutationService } from './mutation-service.js'
import { type BackendProjectReadService, BackendProjectServiceError } from './project-service.js'
import type { BackendSlurmService } from './slurm-service.js'
import {
  type BackendByteResource,
  type BackendStreamService,
  BackendStreamServiceError,
} from './stream-service.js'

export * from './http/paths.js'
export { BACKEND_ROUTE_ALLOW_LIST } from './legacy-routes.js'

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
            slurm: false,
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

/** Diagnostic history changed: a mutation recorded an invocation receipt. */
function publishJournalChange(eventStream: BackendEventStream, project: string): void {
  eventStream.publish({ project, topic: 'journal-change', data: { type: 'record' } })
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
    // PARTIAL: the change landed but its receipt or rollback did not. It is a
    // server-side incomplete operation, never a success and never a conflict.
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
    ...(resource.contentSecurityPolicy
      ? { 'content-security-policy': resource.contentSecurityPolicy }
      : {}),
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
        if (error instanceof JournalRecordingError) {
          writeError(
            response,
            500,
            error.code,
            'Journal recording failed; inspect current documents before retrying.',
          )
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
            status === 409
              ? 'CONFLICT'
              : status === 400
                ? 'BAD_REQUEST'
                : status === 403
                  ? 'FORBIDDEN'
                  : status === 404
                    ? 'NOT_FOUND'
                    : error.code === 'PARTIAL'
                      ? 'PARTIAL'
                      : 'INTERNAL',
            error.code === 'PARTIAL'
              ? 'Mutation partially applied; inspect current documents before retrying.'
              : status >= 500
                ? 'Backend Experiment mutation failed'
                : error.message,
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

    if (route.key === BACKEND_JOURNAL_HISTORY_ROUTE) {
      const project = selectedProject(parsedUrl.searchParams)
      if (!project || !resolved.projectService) {
        writeError(response, 404, 'NOT_FOUND', 'Backend route not found')
        return
      }
      try {
        const actor = decodeBackendActorContext({
          serviceAuthenticated: true,
          headerValue: request.headers[BACKEND_ACTOR_CONTEXT_HEADER],
        })
        // Shell class: receipt paths and error codes are owner diagnostics.
        // The legacy Journal read keeps its own viewer scope and is not
        // widened by this route existing.
        const authorization = authorizeBackendActor({
          actor,
          target: { host: resolved.host, project },
          routeClass: 'shell',
        })
        if (!authorization.ok) {
          writeError(response, 403, 'FORBIDDEN', authorization.message)
          return
        }
        const limit = parsedUrl.searchParams.get('limit')
        writeJson(
          response,
          200,
          BackendJournalHistoryResponseSchema.parse(
            await resolved.projectService.getJournalHistory(
              project,
              limit === null ? undefined : Number(limit),
            ),
          ),
        )
        return
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
        if (error instanceof BackendProjectServiceError) {
          writeError(response, 404, 'NOT_FOUND', 'Backend Project resource not found')
          return
        }
        writeError(response, 500, 'INTERNAL', 'Backend Journal history read failed')
        return
      }
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
          case BACKEND_RUNS_ROUTE: {
            const inventoryOnly = parsedUrl.searchParams.get('inventory') === '1'
            const result = await resolved.projectService.listRuns(
              project,
              {
                includeDeprecated: parsedUrl.searchParams.get('deprecated') === 'include',
                deprecatedOnly: parsedUrl.searchParams.get('deprecated') === 'only',
              },
              { inventoryOnly },
            )
            payload = inventoryOnly
              ? BackendResourceInventoryResponseSchema.parse(result)
              : BackendRunsResponseSchema.parse(result)
            break
          }
          case BACKEND_RUN_ROUTE:
            if (!route.resourceId) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', '')
            payload = BackendRunResponseSchema.parse(
              await resolved.projectService.getRun(project, route.resourceId),
            )
            break
          case BACKEND_EXPERIMENTS_ROUTE: {
            const inventoryOnly = parsedUrl.searchParams.get('inventory') === '1'
            const result = await resolved.projectService.listExperiments(project, { inventoryOnly })
            payload = inventoryOnly
              ? BackendResourceInventoryResponseSchema.parse(result)
              : BackendExperimentsResponseSchema.parse(result)
            break
          }
          case BACKEND_EXPERIMENT_ROUTE: {
            if (!route.resourceId) throw new BackendProjectServiceError('RESOURCE_NOT_FOUND', '')
            payload = BackendExperimentResponseSchema.parse(
              await resolved.projectService.getExperiment(project, route.resourceId),
            )
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
          case BACKEND_REPORTS_ROUTE: {
            const inventoryOnly = parsedUrl.searchParams.get('inventory') === '1'
            const result = await resolved.documentService.listReports(project, { inventoryOnly })
            writeJson(
              response,
              200,
              inventoryOnly
                ? BackendResourceInventoryResponseSchema.parse(result)
                : BackendReportsResponseSchema.parse(result),
            )
            return
          }
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
          case BACKEND_CODE_REVIEWS_ROUTE: {
            const inventoryOnly = parsedUrl.searchParams.get('inventory') === '1'
            const result = await resolved.documentService.listCodeReviews(project, {
              inventoryOnly,
            })
            writeJson(
              response,
              200,
              inventoryOnly
                ? BackendResourceInventoryResponseSchema.parse(result)
                : BackendCodeReviewsResponseSchema.parse(result),
            )
            return
          }
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
            const { activityRecorded, ...publicResult } = mutationResult
            const result = BackendReadmeMutationResponseSchema.parse(publicResult)
            writeJson(response, 200, result)
            resolved.eventStream.publish({
              project,
              topic: route.key === BACKEND_RUN_README_ROUTE ? 'run-change' : 'experiment-change',
              data: { type: 'set', id: route.resourceId },
            })
            if (activityRecorded) publishJournalChange(resolved.eventStream, project)
            return
          }
          case BACKEND_WIKI_ROUTE: {
            const inventoryOnly = parsedUrl.searchParams.get('inventory') === '1'
            const result = await resolved.documentService.listWiki(project, { inventoryOnly })
            writeJson(
              response,
              200,
              inventoryOnly
                ? BackendWikiInventoryResponseSchema.parse(result)
                : BackendWikiPagesResponseSchema.parse(result),
            )
            return
          }
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
        if (error instanceof JournalRecordingError) {
          writeError(
            response,
            500,
            error.code,
            'Journal recording failed; inspect current documents before retrying.',
          )
          return
        }
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
                  : error.code === 'PARTIAL'
                    ? 'PARTIAL'
                    : 'INTERNAL',
            error.code === 'PARTIAL'
              ? 'Mutation partially applied; inspect current documents before retrying.'
              : status >= 500
                ? 'Backend README mutation failed'
                : error.message,
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
          if (error.code === 'EXECUTION_UNAVAILABLE') {
            writeError(
              response,
              501,
              'EXECUTION_UNAVAILABLE',
              'No execution provider is configured',
            )
            return
          }
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

/** Create the independently runnable Node HTTP server without Next/Web code. */
export function createBackendServer(options: BackendServerOptions): Server {
  const resolved = resolveOptions(options)
  const handler = createResolvedBackendHandler(resolved)
  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      writeError(response, 500, 'INTERNAL', 'Backend request failed')
    })
  })
  server.once('close', () => {
    resolved.filesystemMonitor?.stop()
    resolved.eventStream.close()
  })
  return server
}
