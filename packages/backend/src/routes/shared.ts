// Building blocks shared by the route modules: parameter parsers, query
// declarations, operation policies, availability gates and response helpers.

import type { ServerResponse } from 'node:http'
import {
  BackendCodeReviewPatchResponseSchema,
  BackendDocumentConflictResponseSchema,
  BackendDocumentWriteResponseSchema,
  BackendGitRefSchema,
  ProjectNameSchema,
  ResourceIdSchema,
} from '@memon/core'
import type { BackendEventStream } from '../event-stream.js'
import {
  type GateContext,
  type HttpError,
  httpError,
  type RouteOperation,
} from '../http/pipeline.js'
import { writeJson } from '../http/respond.js'
import {
  anyValue,
  emptyOr,
  integerIn,
  matches,
  oneOf,
  type QueryField,
  type QuerySpec,
  type RouteOperationPolicy,
  schemaCheck,
} from '../http/route.js'

export { emptyOr, integerIn, matches, oneOf, schemaCheck }

// --- parameter parsers -----------------------------------------------------

export const parse =
  (check: (value: string) => boolean) =>
  (value: string): string | null =>
    check(value) ? value : null
export const projectParam = parse(schemaCheck(ProjectNameSchema))
export const resourceParam = parse(schemaCheck(ResourceIdSchema))
export const reportIdParam = parse(
  (value) => schemaCheck(ResourceIdSchema)(value) && /^R\d{4}$/.test(value),
)
export const codeReviewIdParam = parse(
  (value) =>
    schemaCheck(ResourceIdSchema)(value) &&
    /^(?:code-review|experiments\/E\d{4}-[a-z0-9-]+\/code-review)\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(
      value,
    ),
)
export const warningRowParam = parse(
  (value) => /^w_[A-Za-z0-9_.:-]+$/.test(value) && value.length <= 128,
)
export const shareIdParam = parse(
  (value) => /^shr_[A-Za-z0-9_-]+$/.test(value) && value.length <= 128,
)
export const gitRefParam = parse(schemaCheck(BackendGitRefSchema))
export const wikiArtifactParam = parse(
  (value) =>
    value.length > 0 &&
    value.length <= 512 &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0'),
)
// `next` is the CLI's "oldest markable commit" alias; core resolves it.
export const wikiShaParam = parse((value) => value === 'next' || /^[0-9a-f]{4,40}$/.test(value))
// Any decoded id stays addressable so the service answers 400 for a non-W id.
export const wikiIdParam = (value: string) => value

// --- query declarations ----------------------------------------------------

export const projectField: QueryField = { check: schemaCheck(ProjectNameSchema), required: true }
export const optional = (check: (value: string) => boolean): QueryField => ({ check })
export const required = (check: (value: string) => boolean): QueryField => ({
  check,
  required: true,
})
export const NO_QUERY: QuerySpec = { fields: {} }
/** Exactly one valid `project` selector plus the given fields. */
export const projectQuery = (
  fields: Record<string, QueryField> = {},
  refine?: QuerySpec['refine'],
) => ({
  fields: { project: projectField, ...fields },
  ...(refine ? { refine } : {}),
})
/** The Project comes from the path; a `project` query, if present, must repeat it. */
export const pathProjectQuery = (
  fields: Record<string, QueryField> = {},
  refine?: QuerySpec['refine'],
) => ({
  fields: { project: optional(anyValue), ...fields },
  refine: (
    values: Readonly<Record<string, string>>,
    input: Parameters<NonNullable<QuerySpec['refine']>>[1],
  ) =>
    (values.project === undefined || values.project === input.params.project) &&
    (refine ? refine(values, input) : true),
})
export const inventoryField = optional(oneOf('1'))
export const submoduleField = optional((value) => value !== '' && value.length <= 512)
export const gitRefField = (isRequired: boolean) =>
  isRequired
    ? required(schemaCheck(BackendGitRefSchema))
    : optional(schemaCheck(BackendGitRefSchema))

// --- operation policies ------------------------------------------------------

export const read: RouteOperationPolicy = { routeClass: 'read', readOnly: 'refuse' }
export const mutating: RouteOperationPolicy = { routeClass: 'mutating', readOnly: 'refuse' }
export const shell: RouteOperationPolicy = { routeClass: 'shell', readOnly: 'refuse' }
/** Owner control writes over `.memon/` state: allowed on a read-only Backend. */
export const controlMutating: RouteOperationPolicy = { routeClass: 'mutating', readOnly: 'allow' }
export const controlShell: RouteOperationPolicy = { routeClass: 'shell', readOnly: 'allow' }

/** Attach handler, gate and error policy to an operation's route class / read-only policy. */
export const op = (
  policy: RouteOperationPolicy,
  rest: Omit<RouteOperation, keyof RouteOperationPolicy>,
): RouteOperation => ({ ...policy, ...rest })

export const requireProject =
  (
    check: (gate: GateContext) => boolean,
    error = httpError(404, 'NOT_FOUND', 'Backend route not found'),
  ) =>
  (gate: GateContext): HttpError | null =>
    gate.project && check(gate) ? null : error

export function selectedReadmeResource(search: URLSearchParams): string | null {
  const values = search.getAll('resource')
  if (values.length !== 1) return null
  const parsed = ResourceIdSchema.safeParse(values[0])
  if (!parsed.success) return null
  return parsed.data === 'README.md' || parsed.data.endsWith('/README.md') ? parsed.data : null
}

export function writeDocumentResult(response: ServerResponse, result: unknown): boolean {
  const conflict = BackendDocumentConflictResponseSchema.safeParse(result)
  if (conflict.success) {
    writeJson(response, 409, conflict.data)
    return false
  }
  writeJson(response, 200, BackendDocumentWriteResponseSchema.parse(result))
  return true
}

export function writeCodeReviewResult(response: ServerResponse, result: unknown): boolean {
  const conflict = BackendDocumentConflictResponseSchema.safeParse(result)
  if (conflict.success) {
    writeJson(response, 409, conflict.data)
    return false
  }
  writeJson(response, 200, BackendCodeReviewPatchResponseSchema.parse(result))
  return true
}

/** Diagnostic history changed: a mutation recorded an invocation receipt. */
export function publishJournalChange(eventStream: BackendEventStream, project: string): void {
  eventStream.publish({ project, topic: 'journal-change', data: { type: 'record' } })
}

/** 409 body carrying the current document state for an optimistic-lock conflict. */
export const MUTATION_UNAVAILABLE = httpError(
  404,
  'UNSUPPORTED_CAPABILITY',
  'Mutation service is unavailable',
)
