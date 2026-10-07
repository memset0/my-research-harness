// The one error → HTTP mapping. Every error class a handler, body reader or
// the pipeline can throw has exactly one mapper here, so the same domain error
// answers with the same status and code on every route. Anything unmapped
// falls back to the operation's declared `failure`.
//
// The mappers live in the HTTP layer rather than on the error classes: the
// services (also called directly by Web) and the core-owned classes stay free
// of HTTP concerns.

import {
  AmbiguousShareError,
  BackendDocumentConflictResponseSchema,
  type BackendErrorCode,
  BackendWikiReviewOrderResponseSchema,
  JournalRecordingError,
  ShareNotFoundError,
  WikiReviewError,
  WikiReviewOrderError,
} from '@memon/core'
import { type FileAccessError, isFileAccessError } from '@memon/file-protocol'
import { BackendActorContextError } from '../actor-context.js'
import { BackendDocumentServiceError } from '../document-service.js'
import { BackendGitServiceError } from '../git-service.js'
import { BackendMutationError } from '../mutation-service.js'
import { BackendProjectServiceError } from '../project-service.js'
import { BackendResultsError } from '../results-summary.js'
import { BackendStreamServiceError } from '../stream-service.js'
import { BackendControlBodyError } from './respond.js'
import { BackendStreamDeadlineError } from './streaming.js'

/** A status plus either the standard error envelope or a route-specific body. */
export interface HttpError {
  status: number
  code: BackendErrorCode
  message: string
  retryable?: boolean
  /** Replaces the standard `{ error }` envelope (conflict state, review order). */
  body?: unknown
}

export const httpError = (
  status: number,
  code: BackendErrorCode,
  message: string,
  retryable?: boolean,
): HttpError => ({ status, code, message, ...(retryable ? { retryable } : {}) })

/**
 * Shared by every service resource error: a malformed or uncontainable
 * identifier is the caller's bad request (400), a well-formed one that does
 * not resolve is 404, and one that resolves to several resources is 409.
 */
function resourceError(code: string, noun: string): HttpError {
  switch (code) {
    case 'INVALID_RESOURCE':
      return httpError(400, 'BAD_REQUEST', `Backend ${noun} resource is invalid`)
    case 'AMBIGUOUS_RESOURCE':
      return httpError(409, 'CONFLICT', `Backend ${noun} resource is ambiguous`)
    default:
      return httpError(404, 'NOT_FOUND', `Backend ${noun} resource not found`)
  }
}

function mutationError(error: BackendMutationError): HttpError {
  switch (error.code) {
    case 'CONFLICT':
      // Optimistic-lock conflict: the body carries the current document state.
      return {
        status: 409,
        code: 'CONFLICT',
        message: error.message,
        body: BackendDocumentConflictResponseSchema.parse({
          error: { code: 'CONFLICT', message: error.message },
          currentMtime: error.current?.mtime,
          currentHash: error.current?.hash,
        }),
      }
    case 'BAD_STATE':
    case 'WARNINGS_SECTION_NOT_TABLE':
      return httpError(409, 'CONFLICT', error.message)
    case 'BAD_REQUEST':
      return httpError(400, 'BAD_REQUEST', error.message)
    case 'FORBIDDEN':
      return httpError(403, 'FORBIDDEN', error.message)
    case 'PROJECT_NOT_FOUND':
    case 'RESOURCE_NOT_FOUND':
      return httpError(404, 'NOT_FOUND', error.message)
    // PARTIAL: the change landed but its receipt or rollback did not. It is a
    // server-side incomplete operation, never a success and never a conflict.
    case 'PARTIAL':
      return httpError(
        500,
        'PARTIAL',
        'Mutation partially applied; inspect current documents before retrying.',
      )
    default:
      return httpError(500, 'INTERNAL', 'Backend mutation failed')
  }
}

function fileAccessError(error: FileAccessError): HttpError {
  switch (error.code) {
    case 'CONFLICT':
      return httpError(409, 'CONFLICT', 'Document changed')
    case 'REPLAY_CONFLICT':
      return httpError(
        409,
        'FILE_REPLAY_CONFLICT',
        'Mutation request identity was reused for different content or authority',
      )
    case 'MUTATION_UNCERTAIN':
      return httpError(
        503,
        'FILE_MUTATION_UNCERTAIN',
        'Source mutation outcome is uncertain; inspect current state before retrying',
      )
    case 'WRITER_UPGRADE_REQUIRED':
      return httpError(
        503,
        'FILE_WRITER_UPGRADE_REQUIRED',
        'Source memon writers must be upgraded and acknowledged before remote writes',
      )
    case 'CAPABILITY_UNAVAILABLE':
      return httpError(
        501,
        'FILE_CAPABILITY_UNAVAILABLE',
        'The file source does not support this operation',
      )
    case 'PROTOCOL_INCOMPATIBLE':
      return httpError(
        502,
        'FILE_PROTOCOL_INCOMPATIBLE',
        'The configured file source protocol is incompatible',
      )
    case 'UNAUTHORIZED':
    case 'FORBIDDEN':
      return httpError(
        503,
        'FILE_SOURCE_FORBIDDEN',
        'The configured file source rejected service credentials or project grants',
      )
    case 'READ_ONLY':
      return httpError(403, 'FORBIDDEN', 'The file source is read-only')
    case 'BAD_REQUEST':
    case 'OUTSIDE_PROJECT':
      return httpError(
        400,
        'BAD_REQUEST',
        'File request is invalid or outside its project authority',
      )
    case 'LIMIT_EXCEEDED':
      return httpError(429, 'FILE_LIMIT_EXCEEDED', 'File source limits were exceeded', true)
    default:
      return httpError(
        503,
        'FILE_SOURCE_UNAVAILABLE',
        'The configured file source is unavailable',
        true,
      )
  }
}

type Mapper<E> = readonly [new (...args: never[]) => E, (error: E) => HttpError]

const mapper = <E>(type: new (...args: never[]) => E, map: (error: E) => HttpError): Mapper<E> => [
  type,
  map,
]

/** Ordered: a subclass precedes its base class. */
const MAPPERS: readonly Mapper<never>[] = [
  mapper(BackendControlBodyError, (error) => httpError(error.status, error.code, error.message)),
  mapper(BackendActorContextError, (error) =>
    httpError(error.status, error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST', error.message),
  ),
  mapper(JournalRecordingError, (error) =>
    httpError(
      500,
      error.code,
      'Journal recording failed; inspect current documents before retrying.',
    ),
  ),
  mapper(BackendMutationError, mutationError),
  // A failed Results summary answers with its own status and body: 400
  // INVALID_RESULTS, 404 RESULTS_NOT_FOUND, 422 RESULT_SCHEMA_MISMATCH /
  // RESULT_DUPLICATE_ROW (the same body standalone routes return).
  mapper(BackendResultsError, (error) => ({
    status: error.status,
    code:
      error.status === 404
        ? 'NOT_FOUND'
        : error.status === 400
          ? 'BAD_REQUEST'
          : 'INVALID_RESOURCE',
    message: error.message,
    body: error.body,
  })),
  mapper(BackendProjectServiceError, (error) => resourceError(error.code, 'Project')),
  mapper(BackendDocumentServiceError, (error) => resourceError(error.code, 'document')),
  mapper(BackendGitServiceError, (error) =>
    error.code === 'EXECUTION_UNAVAILABLE'
      ? httpError(501, 'EXECUTION_UNAVAILABLE', 'No execution provider is configured')
      : resourceError(error.code, 'Git'),
  ),
  mapper(BackendStreamServiceError, (error) => resourceError(error.code, 'stream')),
  mapper(BackendStreamDeadlineError, () =>
    httpError(504, 'UNAVAILABLE', 'Backend stream control deadline exceeded', true),
  ),
  mapper(WikiReviewOrderError, (error) => ({
    status: 409,
    code: 'CONFLICT',
    message: error.message,
    body: BackendWikiReviewOrderResponseSchema.parse({
      error: { code: 'REVIEW_ORDER', message: error.message },
      nextSha: error.nextSha,
    }),
  })),
  mapper(WikiReviewError, () => httpError(404, 'NOT_FOUND', 'Backend wiki review is unavailable')),
  mapper(ShareNotFoundError, () => httpError(404, 'NOT_FOUND', 'Share record not found')),
  mapper(AmbiguousShareError, () =>
    httpError(409, 'CONFLICT', 'Share record selection is ambiguous'),
  ),
] as unknown as readonly Mapper<never>[]

/** The HTTP error for a known error class, or `null` for anything else. */
export function toHttpError(error: unknown): HttpError | null {
  if (isFileAccessError(error)) return fileAccessError(error)
  for (const [type, map] of MAPPERS) {
    if (error instanceof type) return (map as (error: unknown) => HttpError)(error)
  }
  return null
}
