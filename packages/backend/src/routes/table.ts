// The declarative Backend route table: every route's path, parameters,
// query, methods, route class, read-only policy, gate, error policy and
// handler, declared once. The request pipeline derives all routing from it.

import {
  AmbiguousShareError,
  BACKEND_API_MAJOR,
  BackendAnomaliesResponseSchema,
  BackendArchiveMutationRequestSchema,
  BackendCodePreviewResponseSchema,
  BackendCodeReviewResponseSchema,
  BackendCodeReviewsResponseSchema,
  BackendCommitMarkDeleteResponseSchema,
  BackendCommitMarksResponseSchema,
  BackendCommitMarkWriteResponseSchema,
  BackendDocumentWriteRequestSchema,
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
  JournalRecordingError,
  ResourceIdSchema,
  ShareNotFoundError,
  WikiReviewError,
  WikiReviewOrderError,
} from '@memon/core'
import { authorizeBackendActor } from '../actor-context.js'
import { BackendDocumentServiceError } from '../document-service.js'
import { BackendGitServiceError } from '../git-service.js'
import {
  BACKEND_ANOMALIES_ROUTE,
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
  BACKEND_META_PATH,
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
  MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES,
} from '../http/paths.js'
import {
  type BackendRoute,
  type GateContext,
  type HttpError,
  httpError,
  type RouteContext,
  type RouteOperation,
} from '../http/pipeline.js'
import {
  BackendControlBodyError,
  readBoundedJsonRequest,
  readCodeReviewPatchRequest,
  readCommitMarkWriteRequest,
  readDocumentWriteRequest,
  writeError,
  writeJson,
} from '../http/respond.js'
import type { QuerySpec } from '../http/route.js'
import {
  BackendStreamDeadlineError,
  streamByteResource,
  streamLogEvents,
  withStreamControlDeadline,
  writeEventStream,
} from '../http/streaming.js'
import { BackendMutationError } from '../mutation-service.js'
import { BackendProjectServiceError } from '../project-service.js'
import { BackendStreamServiceError } from '../stream-service.js'
import {
  codeReviewIdParam,
  controlMutating,
  controlShell,
  emptyOr,
  gitRefField,
  gitRefParam,
  integerIn,
  inventoryField,
  MUTATION_UNAVAILABLE,
  matches,
  mutating,
  mutationConflict,
  mutationErrorStatus,
  NO_QUERY,
  oneOf,
  op,
  optional,
  parse,
  pathProjectQuery,
  projectParam,
  projectQuery,
  publishJournalChange,
  read,
  reportIdParam,
  required,
  requireProject,
  resourceParam,
  schemaCheck,
  selectedReadmeResource,
  shareIdParam,
  shell,
  submoduleField,
  warningRowParam,
  wikiArtifactParam,
  wikiIdParam,
  wikiShaParam,
  writeCodeReviewResult,
  writeDocumentResult,
} from './shared.js'

const REQUEST_FAILED = httpError(500, 'INTERNAL', 'Backend request failed')

function bodyErrors(error: unknown): HttpError | null {
  return error instanceof BackendControlBodyError
    ? httpError(error.status, error.code, error.message)
    : null
}

function shareErrors(error: unknown): HttpError | null {
  if (error instanceof BackendControlBodyError) {
    return httpError(error.status, error.code, error.message)
  }
  if (error instanceof ShareNotFoundError)
    return httpError(404, 'NOT_FOUND', 'Share record not found')
  if (error instanceof AmbiguousShareError) {
    return httpError(409, 'CONFLICT', 'Share record selection is ambiguous')
  }
  return null
}

const shareOperation = {
  project: 'path' as const,
  available: ({ options }: { options: { capabilities: { shares: boolean } } }) =>
    options.capabilities.shares
      ? null
      : httpError(404, 'UNSUPPORTED_CAPABILITY', 'Share service is unavailable'),
  errors: shareErrors,
  failure: httpError(503, 'UNAVAILABLE', 'Backend share operation failed', true),
}

export const PROJECT_SHARE_ROUTES: readonly BackendRoute[] = [
  {
    key: BACKEND_META_PATH,
    query: NO_QUERY,
    operations: {
      GET: op(
        { routeClass: 'none', readOnly: 'refuse' },
        {
          failure: REQUEST_FAILED,
          async handle({ response, options }) {
            let ready: boolean
            try {
              ready = await options.readiness()
            } catch {
              writeError(response, 503, 'UNAVAILABLE', 'Backend readiness check failed', true)
              return
            }
            writeJson(
              response,
              200,
              BackendMetadataSchema.parse({
                host: options.host,
                release: options.release,
                apiMajor: BACKEND_API_MAJOR,
                revision: options.revision,
                instanceEpoch: options.instanceEpoch,
                ready,
                capabilities: options.capabilities,
              }),
            )
          },
        },
      ),
    },
  },
  {
    key: BACKEND_PROJECTS_PATH,
    query: NO_QUERY,
    operations: {
      // The actor is authorized per discovered Project below.
      GET: op(
        { routeClass: 'actor', readOnly: 'refuse' },
        {
          failure: REQUEST_FAILED,
          async handle({ response, options, actor }) {
            let discovered: unknown
            try {
              discovered = await options.projectDiscovery()
            } catch {
              writeError(response, 503, 'UNAVAILABLE', 'Backend Project discovery failed', true)
              return
            }
            const parsedProjects = BackendProjectDiscoverySchema.safeParse(discovered)
            if (!parsedProjects.success) {
              writeError(
                response,
                500,
                'INTERNAL',
                'Backend Project discovery returned invalid data',
              )
              return
            }
            const projects = parsedProjects.data.flatMap(({ name, ...safeMetadata }) => {
              const target = { host: options.host, project: name }
              const authorization = authorizeBackendActor({
                actor: actor!,
                target,
                routeClass: 'read',
              })
              return authorization.ok ? [{ ...target, ...safeMetadata }] : []
            })
            const payload = BackendProjectsResponseSchema.safeParse({ projects })
            if (!payload.success) {
              writeError(response, 500, 'INTERNAL', 'Backend Project response validation failed')
              return
            }
            writeJson(response, 200, payload.data)
          },
        },
      ),
    },
  },
  {
    key: BACKEND_SHARE_VALIDATE_ROUTE,
    params: { project: projectParam },
    query: NO_QUERY,
    operations: {
      POST: op(controlMutating, {
        project: 'path',
        errors: bodyErrors,
        failure: REQUEST_FAILED,
        async handle({ request, response, options, project }) {
          const parsedBody = BackendShareValidationRequestSchema.safeParse(
            await readBoundedJsonRequest(request, MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES),
          )
          if (!parsedBody.success) {
            throw new BackendControlBodyError(
              400,
              'BAD_REQUEST',
              'Share validation request is invalid',
            )
          }
          let valid: boolean
          try {
            valid = await options.shareValidator(project, parsedBody.data.token)
          } catch {
            writeError(response, 503, 'UNAVAILABLE', 'Backend share validation failed', true)
            return
          }
          writeJson(
            response,
            200,
            BackendShareValidationResponseSchema.parse({ valid: valid === true }),
          )
        },
      }),
    },
  },
  {
    key: BACKEND_SHARES_ROUTE,
    params: { project: projectParam },
    query: (method) =>
      method === 'GET'
        ? pathProjectQuery({ reveal: optional(oneOf('true', 'false')) })
        : pathProjectQuery(),
    operations: {
      GET: op(controlMutating, {
        ...shareOperation,
        async handle({ response, options, project, search }) {
          const reveal = search.get('reveal') === 'true'
          const records = await options.shareProviders.list(project, reveal)
          const parsed = BackendShareListResponseSchema.safeParse({ shares: records })
          if (!parsed.success) throw new Error('invalid share-list provider response')
          const shares = reveal
            ? parsed.data.shares
            : parsed.data.shares.map((record) => ({ ...record, token: '' }))
          writeJson(response, 200, BackendShareListResponseSchema.parse({ shares }))
        },
      }),
      POST: op(controlMutating, {
        ...shareOperation,
        async handle({ request, response, options, project }) {
          const body = BackendShareCreateRequestSchema.safeParse(
            await readBoundedJsonRequest(request, MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES),
          )
          if (!body.success) {
            throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Share create request is invalid')
          }
          const record = await options.shareProviders.add(project, body.data)
          const payload = BackendShareCreateResponseSchema.safeParse({ share: record })
          if (!payload.success) throw new Error('invalid share-add provider response')
          writeJson(response, 201, payload.data)
        },
      }),
    },
  },
  {
    key: BACKEND_SHARE_ITEM_ROUTE,
    params: { project: projectParam, id: shareIdParam },
    query: pathProjectQuery(),
    operations: {
      DELETE: op(controlMutating, {
        ...shareOperation,
        async handle({ response, options, project, params }) {
          const records = await options.shareProviders.revoke(project, params.id!)
          const payload = BackendShareRevokeResponseSchema.safeParse({ revoked: records })
          if (!payload.success) throw new Error('invalid share-revoke provider response')
          writeJson(response, 200, payload.data)
        },
      }),
    },
  },
  {
    key: BACKEND_SLURM_STATUS_ROUTE,
    query: projectQuery(),
    operations: {
      GET: op(read, {
        project: 'query',
        available: ({ options }) =>
          options.readOnly || !options.capabilities.slurm || !options.slurmService
            ? httpError(404, 'INTEGRATION_DISABLED', 'Slurm integration is disabled')
            : null,
        failure: httpError(503, 'UNAVAILABLE', 'Backend Slurm status is unavailable', true),
        async handle({ response, options }) {
          writeJson(
            response,
            200,
            BackendSlurmStatusSchema.parse(await options.slurmService!.status()),
          )
        },
      }),
    },
  },
]

const id = { id: resourceParam }

// --- Project data reads ------------------------------------------------------

function projectReadErrors(error: unknown): HttpError | null {
  if (!(error instanceof BackendProjectServiceError)) return null
  return error.code === 'INVALID_RESOURCE'
    ? httpError(422, 'BAD_REQUEST', 'Backend Project resource is invalid')
    : httpError(404, 'NOT_FOUND', 'Backend Project resource not found')
}

const projectRead = (handle: (ctx: RouteContext) => Promise<unknown>): RouteOperation =>
  op(read, {
    project: 'query',
    available: requireProject(({ options }) => options.projectService !== undefined),
    errors: projectReadErrors,
    failure: httpError(500, 'INTERNAL', 'Backend Project read failed'),
    async handle(ctx) {
      writeJson(ctx.response, 200, await handle(ctx))
    },
  })

/** Project data reads answer an unserved method with 404, not 405. */
const projectDataRoute = (
  key: string,
  query: BackendRoute['query'],
  operations: BackendRoute['operations'],
  params?: BackendRoute['params'],
): BackendRoute => ({
  key,
  ...(params ? { params } : {}),
  query,
  unknownMethod: 'not-found',
  operations,
})

// --- Experiment create / delete / link / unlink --------------------------------

function experimentMutationErrors(error: unknown): HttpError | null {
  if (error instanceof JournalRecordingError) {
    return httpError(
      500,
      error.code,
      'Journal recording failed; inspect current documents before retrying.',
    )
  }
  if (!(error instanceof BackendMutationError)) return null
  if (error.code === 'CONFLICT') return mutationConflict(error)
  const status = mutationErrorStatus(error)
  return httpError(
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
}

const mutationAvailable = ({ options }: Parameters<NonNullable<RouteOperation['available']>>[0]) =>
  !options.mutationService || !options.capabilities.mutations ? MUTATION_UNAVAILABLE : null

const experimentMutation = (handle: RouteOperation['handle']): RouteOperation =>
  op(mutating, {
    project: 'query',
    available: mutationAvailable,
    errors: experimentMutationErrors,
    failure: httpError(400, 'BAD_REQUEST', 'Experiment mutation request is invalid'),
    handle,
  })

async function createExperiment({ request, response, options, project }: RouteContext) {
  const raw = await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES)
  const { project: bodyProject, ...input } = BackendExperimentCreateRequestSchema.parse(raw)
  if (bodyProject !== undefined && bodyProject !== project) {
    writeError(response, 400, 'BAD_REQUEST', 'body Project does not match selector')
    return
  }
  const result = BackendExperimentCreateResponseSchema.parse(
    await options.mutationService!.createExperiment(project, input),
  )
  writeJson(response, 200, result)
  options.eventStream.publish({
    project,
    topic: 'experiment-change',
    data: { type: 'set', id: result.id },
  })
  if (input.fromRun) {
    options.eventStream.publish({
      project,
      topic: 'run-change',
      data: { type: 'set', id: input.fromRun, parentExperimentId: result.id },
    })
  }
  publishJournalChange(options.eventStream, project)
}

async function deleteExperiment({
  request,
  response,
  options,
  project,
  params,
  search,
}: RouteContext) {
  const raw = await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES)
  const input = BackendExperimentDeleteRequestSchema.parse({
    ...(raw as object),
    force: search.get('force') === 'true',
  })
  const result = BackendExperimentDeleteResponseSchema.parse(
    await options.mutationService!.deleteExperiment(project, params.id!, input),
  )
  writeJson(response, 200, result)
  options.eventStream.publish({
    project,
    topic: 'experiment-change',
    data: { type: 'delete', id: result.deletedId },
  })
  for (const runId of result.cascadedRuns) {
    options.eventStream.publish({
      project,
      topic: 'run-change',
      data: { type: 'set', id: runId, parentExperimentId: null },
    })
  }
  publishJournalChange(options.eventStream, project)
}

const bindExperiment =
  (operation: 'link' | 'unlink') =>
  async ({ request, response, options, project, params }: RouteContext) => {
    const raw = await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES)
    const input = BackendExperimentBindRequestSchema.parse(raw)
    const result = BackendExperimentBindResponseSchema.parse(
      await options.mutationService!.bindExperiment(operation, project, params.id!, input),
    )
    writeJson(response, 200, result)
    options.eventStream.publish({
      project,
      topic: 'experiment-change',
      data: { type: 'set', id: result.experimentId },
    })
    options.eventStream.publish({
      project,
      topic: 'run-change',
      data: {
        type: 'set',
        id: result.runId,
        parentExperimentId: operation === 'link' ? result.experimentId : null,
      },
    })
    publishJournalChange(options.eventStream, project)
  }

// --- status / archive --------------------------------------------------------------

function statusArchiveErrors(error: unknown): HttpError | null {
  if (!(error instanceof BackendMutationError)) return null
  if (error.code === 'CONFLICT') return mutationConflict(error)
  return error.code === 'FORBIDDEN'
    ? httpError(403, 'FORBIDDEN', error.message)
    : httpError(404, 'NOT_FOUND', error.message)
}

const stateMutation = (kind: 'run' | 'experiment', field: 'status' | 'archive'): RouteOperation =>
  op(mutating, {
    project: 'query',
    available: mutationAvailable,
    errors: statusArchiveErrors,
    failure: httpError(400, 'BAD_REQUEST', 'Mutation request is invalid'),
    async handle({ request, response, options, project, params }) {
      const raw = await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES)
      const service = options.mutationService!
      const result =
        field === 'status'
          ? kind === 'run'
            ? await service.setRunStatus(
                project,
                params.id!,
                BackendStatusMutationRequestSchema.parse(raw),
              )
            : await service.setExperimentStatus(
                project,
                params.id!,
                BackendStatusMutationRequestSchema.parse(raw),
              )
          : kind === 'run'
            ? await service.setRunArchived(
                project,
                params.id!,
                BackendArchiveMutationRequestSchema.parse(raw),
              )
            : await service.setExperimentArchived(
                project,
                params.id!,
                BackendArchiveMutationRequestSchema.parse(raw),
              )
      writeJson(response, 200, BackendMutationResponseSchema.parse(result))
      options.eventStream.publish({
        project,
        topic: kind === 'run' ? 'run-change' : 'experiment-change',
        data: { type: 'set', id: params.id! },
      })
    },
  })

// --- warnings --------------------------------------------------------------------

function warningErrors(error: unknown): HttpError | null {
  if (!(error instanceof BackendMutationError)) return null
  if (error.code === 'CONFLICT') return mutationConflict(error)
  if (error.code === 'WARNINGS_SECTION_NOT_TABLE') return httpError(409, 'CONFLICT', error.message)
  return error.code === 'FORBIDDEN'
    ? httpError(403, 'FORBIDDEN', error.message)
    : error.code === 'BAD_REQUEST'
      ? httpError(400, 'BAD_REQUEST', error.message)
      : httpError(404, 'NOT_FOUND', error.message)
}

const warningOperation = (
  kind: 'run' | 'experiment',
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
) =>
  op(method === 'GET' ? read : mutating, {
    project: 'query',
    available: ({ options, method: requestMethod }) =>
      !options.mutationService || (requestMethod !== 'GET' && !options.capabilities.mutations)
        ? httpError(404, 'UNSUPPORTED_CAPABILITY', 'Warning service is unavailable')
        : null,
    errors: warningErrors,
    failure: httpError(400, 'BAD_REQUEST', 'Warning request is invalid'),
    async handle({ request, response, options, project, params }) {
      const service = options.mutationService!
      if (method === 'GET') {
        writeJson(
          response,
          200,
          BackendWarningsResponseSchema.parse(
            await service.listWarnings(kind, project, params.id!),
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
      const result = await service.mutateWarning(kind, project, params.id!, {
        ...input,
        rowId: params.rowId ?? input.rowId,
      })
      writeJson(response, 200, BackendWarningMutationResponseSchema.parse(result))
      options.eventStream.publish({
        project,
        topic: kind === 'run' ? 'run-change' : 'experiment-change',
        data: { type: 'set', id: params.id! },
      })
    },
  })

// --- table ---------------------------------------------------------------------------

const experimentQuery = (method: string): QuerySpec =>
  method === 'DELETE' ? projectQuery({ force: optional(oneOf('true', 'false')) }) : projectQuery()

export const RUN_EXPERIMENT_ROUTES: readonly BackendRoute[] = [
  projectDataRoute(
    BACKEND_RUNS_ROUTE,
    projectQuery(
      { deprecated: optional(oneOf('include', 'only')), inventory: inventoryField },
      (values) => !(values.inventory !== undefined && values.deprecated !== undefined),
    ),
    {
      // `deprecated` is the explicit-inspection selector for the Run
      // collection: absent means the research default (deprecated Runs
      // excluded), `include` adds them, `only` returns just them.
      GET: projectRead(async ({ options, project, search }) => {
        const inventoryOnly = search.get('inventory') === '1'
        const result = await options.projectService!.listRuns(
          project,
          {
            includeDeprecated: search.get('deprecated') === 'include',
            deprecatedOnly: search.get('deprecated') === 'only',
          },
          { inventoryOnly },
        )
        return inventoryOnly
          ? BackendResourceInventoryResponseSchema.parse(result)
          : BackendRunsResponseSchema.parse(result)
      }),
    },
  ),
  projectDataRoute(
    BACKEND_RUN_ROUTE,
    projectQuery(),
    {
      GET: projectRead(async ({ options, project, params }) =>
        BackendRunResponseSchema.parse(await options.projectService!.getRun(project, params.id!)),
      ),
    },
    id,
  ),
  projectDataRoute(BACKEND_EXPERIMENTS_ROUTE, projectQuery({ inventory: inventoryField }), {
    GET: projectRead(async ({ options, project, search }) => {
      const inventoryOnly = search.get('inventory') === '1'
      const result = await options.projectService!.listExperiments(project, { inventoryOnly })
      return inventoryOnly
        ? BackendResourceInventoryResponseSchema.parse(result)
        : BackendExperimentsResponseSchema.parse(result)
    }),
    POST: experimentMutation(createExperiment),
  }),
  projectDataRoute(
    BACKEND_EXPERIMENT_ROUTE,
    experimentQuery,
    {
      GET: projectRead(async ({ options, project, params }) =>
        BackendExperimentResponseSchema.parse(
          await options.projectService!.getExperiment(project, params.id!),
        ),
      ),
      DELETE: experimentMutation(deleteExperiment),
    },
    id,
  ),
  projectDataRoute(
    BACKEND_RUN_FILES_ROUTE,
    projectQuery({ depth: optional(matches(/^[1-6]$/)) }),
    {
      GET: projectRead(async ({ options, project, params, search }) =>
        BackendRunFilesResponseSchema.parse(
          await options.projectService!.getRunFiles(
            project,
            params.id!,
            Number(search.get('depth') ?? 3),
          ),
        ),
      ),
    },
    id,
  ),
  projectDataRoute(
    BACKEND_EXPERIMENT_RESULTS_ROUTE,
    projectQuery(),
    {
      GET: projectRead(async ({ options, project, params }) =>
        BackendExperimentResultsResponseSchema.parse(
          await options.projectService!.getExperimentResults(project, params.id!),
        ),
      ),
    },
    id,
  ),
  projectDataRoute(BACKEND_HYPOTHESES_ROUTE, projectQuery(), {
    GET: projectRead(async ({ options, project }) =>
      BackendHypothesesResponseSchema.parse(await options.projectService!.getHypotheses(project)),
    ),
  }),
  projectDataRoute(
    BACKEND_JOURNAL_ROUTE,
    projectQuery({
      limit: optional(emptyOr(matches(/^\d{1,6}$/))),
      before: optional((value) => value.length <= 128),
      countOnly: optional(oneOf('1')),
    }),
    {
      GET: projectRead(async ({ options, project, search }) => {
        const journal = BackendJournalResponseSchema.parse(
          await options.projectService!.getJournal(project),
        )
        if (search.get('countOnly') === '1') {
          return BackendJournalCountResponseSchema.parse({ totalEvents: journal.events.length })
        }
        const before = search.get('before')
        const limit = search.get('limit')
        const events = before
          ? journal.events.filter((event) => event.timestamp < before)
          : journal.events
        return BackendJournalResponseSchema.parse({
          ...journal,
          events: limit ? events.slice(0, Number(limit)) : events,
        })
      }),
    },
  ),
  {
    key: BACKEND_JOURNAL_HISTORY_ROUTE,
    query: projectQuery({ limit: optional(matches(/^\d{1,6}$/)) }),
    operations: {
      // Shell class: receipt paths and error codes are owner diagnostics. The
      // legacy Journal read keeps its own viewer scope.
      GET: op(shell, {
        project: 'query',
        available: requireProject(({ options }) => options.projectService !== undefined),
        errors: (error) =>
          error instanceof BackendProjectServiceError
            ? httpError(404, 'NOT_FOUND', 'Backend Project resource not found')
            : null,
        failure: httpError(500, 'INTERNAL', 'Backend Journal history read failed'),
        async handle({ response, options, project, search }) {
          const limit = search.get('limit')
          writeJson(
            response,
            200,
            BackendJournalHistoryResponseSchema.parse(
              await options.projectService!.getJournalHistory(
                project,
                limit === null ? undefined : Number(limit),
              ),
            ),
          )
        },
      }),
    },
  },
  projectDataRoute(BACKEND_ANOMALIES_ROUTE, projectQuery(), {
    GET: projectRead(async ({ options, project }) =>
      BackendAnomaliesResponseSchema.parse(await options.projectService!.getAnomalies(project)),
    ),
  }),
  {
    key: BACKEND_RUN_STATUS_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { PATCH: stateMutation('run', 'status') },
  },
  {
    key: BACKEND_RUN_ARCHIVE_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { PATCH: stateMutation('run', 'archive') },
  },
  {
    key: BACKEND_EXPERIMENT_STATUS_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { PATCH: stateMutation('experiment', 'status') },
  },
  {
    key: BACKEND_EXPERIMENT_ARCHIVE_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { PATCH: stateMutation('experiment', 'archive') },
  },
  {
    key: BACKEND_RUN_WARNINGS_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { GET: warningOperation('run', 'GET'), POST: warningOperation('run', 'POST') },
  },
  {
    key: BACKEND_RUN_WARNING_ROUTE,
    params: { ...id, rowId: warningRowParam },
    query: projectQuery(),
    operations: {
      PATCH: warningOperation('run', 'PATCH'),
      DELETE: warningOperation('run', 'DELETE'),
    },
  },
  {
    key: BACKEND_EXPERIMENT_WARNINGS_ROUTE,
    params: id,
    query: projectQuery(),
    operations: {
      GET: warningOperation('experiment', 'GET'),
      POST: warningOperation('experiment', 'POST'),
    },
  },
  {
    key: BACKEND_EXPERIMENT_WARNING_ROUTE,
    params: { ...id, rowId: warningRowParam },
    query: projectQuery(),
    operations: {
      PATCH: warningOperation('experiment', 'PATCH'),
      DELETE: warningOperation('experiment', 'DELETE'),
    },
  },
  {
    key: BACKEND_EXPERIMENT_LINK_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { POST: experimentMutation(bindExperiment('link')) },
  },
  {
    key: BACKEND_EXPERIMENT_UNLINK_ROUTE,
    params: id,
    query: projectQuery(),
    operations: { POST: experimentMutation(bindExperiment('unlink')) },
  },
]

function documentErrors(error: unknown): HttpError | null {
  if (error instanceof JournalRecordingError) {
    return httpError(
      500,
      error.code,
      'Journal recording failed; inspect current documents before retrying.',
    )
  }
  if (error instanceof BackendControlBodyError) {
    return httpError(error.status, error.code, error.message)
  }
  if (error instanceof BackendDocumentServiceError) {
    return error.code === 'INVALID_RESOURCE'
      ? httpError(400, 'BAD_REQUEST', 'Backend document resource is invalid')
      : error.code === 'AMBIGUOUS_RESOURCE'
        ? httpError(409, 'CONFLICT', 'Backend document resource is ambiguous')
        : httpError(404, 'NOT_FOUND', 'Backend document resource not found')
  }
  if (error instanceof BackendMutationError) {
    if (error.code === 'CONFLICT') return mutationConflict(error)
    const status = mutationErrorStatus(error)
    return httpError(
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
  }
  if (error instanceof BackendProjectServiceError) {
    return httpError(404, 'NOT_FOUND', 'Backend README resource not found')
  }
  return null
}

const documentOperation = (
  method: 'GET' | 'PUT' | 'PATCH',
  handle: RouteOperation['handle'],
  needs: { project?: boolean; mutation?: boolean } = {},
): RouteOperation =>
  op(method === 'GET' ? read : mutating, {
    project: 'query',
    available: requireProject(
      ({ options }) =>
        options.documentService !== undefined &&
        (!needs.project || options.projectService !== undefined) &&
        (!needs.mutation || options.mutationService !== undefined),
    ),
    errors: documentErrors,
    failure: httpError(500, 'INTERNAL', 'Backend document operation failed'),
    handle,
  })

const inventoryList =
  (
    list: (ctx: RouteContext, inventoryOnly: boolean) => Promise<unknown>,
    full: { parse(value: unknown): unknown },
    inventory: { parse(value: unknown): unknown } = BackendResourceInventoryResponseSchema,
  ) =>
  async (ctx: RouteContext) => {
    const inventoryOnly = ctx.search.get('inventory') === '1'
    const result = await list(ctx, inventoryOnly)
    writeJson(ctx.response, 200, inventoryOnly ? inventory.parse(result) : full.parse(result))
  }

/** README read/write addressed by Run or Experiment id. */
const resourceReadme = (kind: 'run' | 'experiment', method: 'GET' | 'PUT') =>
  documentOperation(
    method,
    async ({ request, response, options, project, params }) => {
      const detail =
        kind === 'run'
          ? BackendRunResponseSchema.parse(
              await options.projectService!.getRun(project, params.id!),
            )
          : BackendExperimentResponseSchema.parse(
              await options.projectService!.getExperiment(project, params.id!),
            )
      if (method === 'GET') {
        writeJson(
          response,
          200,
          BackendReadmeResponseSchema.parse(
            await options.documentService!.getReadme(project, detail.resource),
          ),
        )
        return
      }
      const input = BackendDocumentWriteRequestSchema.parse(
        await readBoundedJsonRequest(request, MAX_BACKEND_DOCUMENT_BODY_BYTES),
      )
      const mutationResult =
        kind === 'run'
          ? await options.mutationService!.writeRunReadme(project, params.id!, input)
          : await options.mutationService!.writeExperimentReadme(project, params.id!, input)
      const { activityRecorded, ...publicResult } = mutationResult
      writeJson(response, 200, BackendReadmeMutationResponseSchema.parse(publicResult))
      options.eventStream.publish({
        project,
        topic: kind === 'run' ? 'run-change' : 'experiment-change',
        data: { type: 'set', id: params.id! },
      })
      if (activityRecorded) publishJournalChange(options.eventStream, project)
    },
    { project: true, mutation: method === 'PUT' },
  )

// --- Wiki review -------------------------------------------------------------------

function wikiReviewErrors(error: unknown): HttpError | null {
  if (error instanceof WikiReviewOrderError) {
    return {
      status: 409,
      code: 'CONFLICT',
      message: error.message,
      body: BackendWikiReviewOrderResponseSchema.parse({
        error: { code: 'REVIEW_ORDER', message: error.message },
        nextSha: error.nextSha,
      }),
    }
  }
  if (error instanceof WikiReviewError) {
    return httpError(404, 'NOT_FOUND', 'Backend wiki review is unavailable')
  }
  if (error instanceof BackendDocumentServiceError) {
    return error.code === 'INVALID_RESOURCE'
      ? httpError(400, 'BAD_REQUEST', error.message)
      : httpError(404, 'NOT_FOUND', error.message)
  }
  if (error instanceof BackendControlBodyError) {
    return httpError(error.status, error.code, error.message)
  }
  return null
}

// Shell class: verification is an owner judgement, never a viewer's. Review
// marks record human trust in `.memon/`, not Project content.
const wikiReviewOperation = (
  policy: typeof shell,
  handle: RouteOperation['handle'],
): RouteOperation =>
  op(policy, {
    project: 'query',
    available: requireProject(({ options }) => options.documentService !== undefined),
    errors: wikiReviewErrors,
    failure: httpError(400, 'BAD_REQUEST', 'Backend wiki review request is invalid'),
    handle,
  })

const wikiReviewMark =
  (method: 'POST' | 'DELETE') =>
  async ({ request, response, options, project, params }: RouteContext) => {
    let note: string | undefined
    if (method === 'POST' && request.headers['content-type'] !== undefined) {
      note = BackendWikiReviewMarkRequestSchema.parse(
        await readBoundedJsonRequest(request, MAX_BACKEND_CONTROL_JSON_BYTES),
      ).note
    }
    const log =
      method === 'POST'
        ? await options.documentService!.markWikiReview(project, params.sha!, note)
        : await options.documentService!.unmarkWikiReview(project, params.sha!)
    writeJson(response, 200, BackendWikiReviewResponseSchema.parse(log))
    options.eventStream.publish({ project, topic: 'wiki-review-change', data: {} })
    options.eventStream.publish({ project, topic: 'wiki-change', data: { type: 'review' } })
  }

export const DOCUMENT_WIKI_ROUTES: readonly BackendRoute[] = [
  {
    key: BACKEND_REPORTS_ROUTE,
    query: projectQuery({ inventory: inventoryField }),
    operations: {
      GET: documentOperation(
        'GET',
        inventoryList(
          ({ options, project }, inventoryOnly) =>
            options.documentService!.listReports(project, { inventoryOnly }),
          BackendReportsResponseSchema,
        ),
      ),
    },
  },
  {
    key: BACKEND_REPORT_ROUTE,
    params: { id: reportIdParam },
    query: projectQuery(),
    operations: {
      GET: documentOperation('GET', async ({ response, options, project, params }) => {
        writeJson(
          response,
          200,
          BackendReportResponseSchema.parse(
            await options.documentService!.getReport(project, params.id!),
          ),
        )
      }),
      PUT: documentOperation('PUT', async ({ request, response, options, project, params }) => {
        const result = await options.documentService!.putReport(
          project,
          params.id!,
          await readDocumentWriteRequest(request),
        )
        if (writeDocumentResult(response, result)) {
          options.eventStream.publish({
            project,
            topic: 'reports-change',
            data: { type: 'set', id: params.id! },
          })
        }
      }),
    },
  },
  {
    key: BACKEND_CODE_REVIEWS_ROUTE,
    query: projectQuery({ inventory: inventoryField }),
    operations: {
      GET: documentOperation(
        'GET',
        inventoryList(
          ({ options, project }, inventoryOnly) =>
            options.documentService!.listCodeReviews(project, { inventoryOnly }),
          BackendCodeReviewsResponseSchema,
        ),
      ),
    },
  },
  {
    key: BACKEND_CODE_REVIEW_ROUTE,
    params: { id: codeReviewIdParam },
    query: projectQuery(),
    operations: {
      GET: documentOperation('GET', async ({ response, options, project, params }) => {
        writeJson(
          response,
          200,
          BackendCodeReviewResponseSchema.parse(
            await options.documentService!.getCodeReview(project, params.id!),
          ),
        )
      }),
      PATCH: documentOperation('PATCH', async ({ request, response, options, project, params }) => {
        const result = await options.documentService!.patchCodeReview(
          project,
          params.id!,
          await readCodeReviewPatchRequest(request),
        )
        if (writeCodeReviewResult(response, result)) {
          options.eventStream.publish({
            project,
            topic: 'code-reviews-change',
            data: { type: 'set', id: params.id! },
          })
        }
      }),
    },
  },
  {
    key: BACKEND_README_ROUTE,
    query: projectQuery({
      resource: required(
        (value) =>
          schemaCheck(ResourceIdSchema)(value) &&
          (value === 'README.md' || value.endsWith('/README.md')),
      ),
    }),
    operations: {
      GET: documentOperation('GET', async ({ response, options, project, search }) => {
        const resource = selectedReadmeResource(search)
        if (!resource) throw new BackendDocumentServiceError('INVALID_RESOURCE', '')
        writeJson(
          response,
          200,
          BackendReadmeResponseSchema.parse(
            await options.documentService!.getReadme(project, resource),
          ),
        )
      }),
      PUT: documentOperation('PUT', async ({ request, response, options, project, search }) => {
        const resource = selectedReadmeResource(search)
        if (!resource) throw new BackendDocumentServiceError('INVALID_RESOURCE', '')
        const result = await options.documentService!.putReadme(
          project,
          resource,
          await readDocumentWriteRequest(request),
        )
        if (!writeDocumentResult(response, result)) return
        const run = /^logs\/([^/]+)\/README\.md$/.exec(resource)
        const experiment = /^docs\/experiments\/([^/]+)\/README\.md$/.exec(resource)
        if (run?.[1]) {
          options.eventStream.publish({
            project,
            topic: 'run-change',
            data: { type: 'set', id: run[1] },
          })
        } else if (experiment?.[1]) {
          options.eventStream.publish({
            project,
            topic: 'experiment-change',
            data: { type: 'set', id: experiment[1] },
          })
        }
      }),
    },
  },
  {
    key: BACKEND_RUN_README_ROUTE,
    params: { id: resourceParam },
    query: projectQuery(),
    operations: { GET: resourceReadme('run', 'GET'), PUT: resourceReadme('run', 'PUT') },
  },
  {
    key: BACKEND_EXPERIMENT_README_ROUTE,
    params: { id: resourceParam },
    query: projectQuery(),
    operations: {
      GET: resourceReadme('experiment', 'GET'),
      PUT: resourceReadme('experiment', 'PUT'),
    },
  },
  {
    key: BACKEND_WIKI_ROUTE,
    query: projectQuery({ inventory: inventoryField }),
    operations: {
      GET: documentOperation(
        'GET',
        inventoryList(
          ({ options, project }, inventoryOnly) =>
            options.documentService!.listWiki(project, { inventoryOnly }),
          BackendWikiPagesResponseSchema,
          BackendWikiInventoryResponseSchema,
        ),
      ),
    },
  },
  {
    key: BACKEND_WIKI_PAGE_ROUTE,
    params: { id: wikiIdParam },
    query: projectQuery(),
    operations: {
      GET: documentOperation('GET', async ({ response, options, project, params }) => {
        writeJson(
          response,
          200,
          BackendWikiDocumentSchema.parse(
            await options.documentService!.getWiki(project, params.id!),
          ),
        )
      }),
      PUT: documentOperation('PUT', async ({ request, response, options, project, params }) => {
        const result = await options.documentService!.putWiki(
          project,
          params.id!,
          await readDocumentWriteRequest(request),
        )
        const conflict = BackendWikiConflictResponseSchema.safeParse(result)
        if (conflict.success) {
          writeJson(response, 409, conflict.data)
          return
        }
        writeJson(response, 200, BackendWikiWriteResponseSchema.parse(result))
        options.eventStream.publish({
          project,
          topic: 'wiki-change',
          data: { type: 'set', id: params.id! },
        })
      }),
    },
  },
  {
    key: BACKEND_WIKI_BACKLINKS_ROUTE,
    params: { artifact: wikiArtifactParam },
    query: projectQuery(),
    operations: {
      GET: documentOperation('GET', async ({ response, options, project, params }) => {
        writeJson(
          response,
          200,
          BackendWikiBacklinksResponseSchema.parse({
            artifact: params.artifact!,
            pages: await options.documentService!.wikiBacklinks(project, params.artifact!),
          }),
        )
      }),
    },
  },
  {
    key: BACKEND_WIKI_REVIEW_ROUTE,
    query: projectQuery(),
    operations: {
      GET: wikiReviewOperation(shell, async ({ response, options, project }) => {
        writeJson(
          response,
          200,
          BackendWikiReviewResponseSchema.parse(
            await options.documentService!.wikiReviewLog(project),
          ),
        )
      }),
    },
  },
  {
    key: BACKEND_WIKI_REVIEW_MARK_ROUTE,
    params: { sha: wikiShaParam },
    query: projectQuery(),
    operations: {
      POST: wikiReviewOperation(controlShell, wikiReviewMark('POST')),
      DELETE: wikiReviewOperation(controlShell, wikiReviewMark('DELETE')),
    },
  },
]

function gitErrors(error: unknown): HttpError | null {
  if (error instanceof BackendControlBodyError) {
    return httpError(error.status, error.code, error.message)
  }
  if (!(error instanceof BackendGitServiceError)) return null
  if (error.code === 'EXECUTION_UNAVAILABLE') {
    return httpError(501, 'EXECUTION_UNAVAILABLE', 'No execution provider is configured')
  }
  return error.code === 'INVALID_RESOURCE'
    ? httpError(400, 'BAD_REQUEST', 'Backend Git resource is invalid')
    : httpError(404, 'NOT_FOUND', 'Backend Git resource not found')
}

const gitOperation = (
  method: 'GET' | 'PUT' | 'DELETE',
  project: 'path' | 'query',
  handle: (ctx: RouteContext, submodule: string | undefined) => Promise<void>,
): RouteOperation =>
  op(method === 'GET' ? read : mutating, {
    project,
    available: requireProject(
      ({ options, method: requestMethod }) =>
        options.gitService !== undefined &&
        options.capabilities.git &&
        (requestMethod === 'GET' || options.capabilities.mutations),
    ),
    errors: gitErrors,
    failure: httpError(500, 'INTERNAL', 'Backend Git operation failed'),
    handle: (ctx) => handle(ctx, ctx.search.get('submodule') ?? undefined),
  })

/** A Git read whose JSON response is validated by `schema`. */
const gitRead = (
  read: (ctx: RouteContext, submodule: string | undefined) => Promise<unknown>,
  schema: { parse(value: unknown): unknown },
  maxBytes?: number,
) =>
  gitOperation('GET', 'path', async (ctx, submodule) => {
    writeJson(ctx.response, 200, schema.parse(await read(ctx, submodule)), maxBytes)
  })

const gitRoute = (
  key: string,
  query: QuerySpec,
  operations: BackendRoute['operations'],
): BackendRoute => ({ key, params: { project: projectParam }, query, operations })

export const GIT_ROUTES: readonly BackendRoute[] = [
  gitRoute(BACKEND_GIT_STATUS_ROUTE, pathProjectQuery(), {
    GET: gitRead(
      ({ options, project }) => options.gitService!.status(project),
      BackendGitStatusResponseSchema,
    ),
  }),
  gitRoute(BACKEND_GIT_STATUS_FILES_ROUTE, pathProjectQuery({ submodule: submoduleField }), {
    GET: gitRead(
      ({ options, project }, submodule) => options.gitService!.statusFiles(project, { submodule }),
      BackendGitStatusFilesResponseSchema,
    ),
  }),
  gitRoute(BACKEND_GIT_BRANCHES_ROUTE, pathProjectQuery({ submodule: submoduleField }), {
    GET: gitRead(
      ({ options, project }, submodule) => options.gitService!.branches(project, { submodule }),
      BackendGitBranchesResponseSchema,
    ),
  }),
  gitRoute(
    BACKEND_GIT_LOG_ROUTE,
    pathProjectQuery({
      ref: gitRefField(true),
      limit: { check: emptyOr(integerIn(/^\d{1,4}$/, 1, 1000)) },
      submodule: submoduleField,
    }),
    {
      GET: gitRead(
        ({ options, project, search }, submodule) =>
          options.gitService!.log(project, {
            ref: search.get('ref')!,
            limit: Number(search.get('limit') ?? 100),
            submodule,
          }),
        BackendGitLogResponseSchema,
      ),
    },
  ),
  gitRoute(
    BACKEND_GIT_COMMIT_ROUTE,
    pathProjectQuery({ sha: gitRefField(true), submodule: submoduleField }),
    {
      GET: gitRead(
        ({ options, project, search }, submodule) =>
          options.gitService!.commit(project, search.get('sha')!, { submodule }),
        BackendGitCommitResponseSchema,
      ),
    },
  ),
  gitRoute(
    BACKEND_GIT_RANGE_ROUTE,
    pathProjectQuery({ from: gitRefField(true), to: gitRefField(true), submodule: submoduleField }),
    {
      GET: gitRead(
        ({ options, project, search }, submodule) =>
          options.gitService!.range(project, {
            from: search.get('from')!,
            to: search.get('to')!,
            submodule,
          }),
        BackendGitRangeResponseSchema,
      ),
    },
  ),
  gitRoute(
    BACKEND_GIT_DIFF_ROUTE,
    pathProjectQuery(
      {
        path: required(schemaCheck(ResourceIdSchema)),
        side: required(oneOf('staged', 'unstaged', 'untracked', 'commit', 'range')),
        sha: gitRefField(false),
        from: gitRefField(false),
        to: gitRefField(false),
        submodule: submoduleField,
      },
      ({ side, sha, from, to }) =>
        side === 'commit'
          ? sha !== undefined && from === undefined && to === undefined
          : side === 'range'
            ? from !== undefined && to !== undefined && sha === undefined
            : sha === undefined && from === undefined && to === undefined,
    ),
    {
      GET: gitRead(
        ({ options, project, search }, submodule) =>
          options.gitService!.diff(project, {
            path: search.get('path')!,
            side: search.get('side') as 'staged' | 'unstaged' | 'untracked' | 'commit' | 'range',
            ...(search.get('sha') ? { sha: search.get('sha')! } : {}),
            ...(search.get('from') ? { from: search.get('from')! } : {}),
            ...(search.get('to') ? { to: search.get('to')! } : {}),
            submodule,
          }),
        BackendGitDiffResponseSchema,
        5 * 1024 * 1024,
      ),
    },
  ),
  gitRoute(BACKEND_GIT_SUBMODULES_ROUTE, pathProjectQuery(), {
    GET: gitRead(
      ({ options, project }) => options.gitService!.submodules(project),
      BackendGitSubmodulesResponseSchema,
    ),
  }),
  gitRoute(BACKEND_GIT_COMMIT_MARKS_ROUTE, pathProjectQuery(), {
    GET: gitRead(
      ({ options, project }) => options.gitService!.commitMarks(project),
      BackendCommitMarksResponseSchema,
    ),
  }),
  {
    key: BACKEND_GIT_COMMIT_MARK_ROUTE,
    params: { project: projectParam, sha: gitRefParam },
    query: pathProjectQuery({ submodule: submoduleField }),
    operations: {
      PUT: gitOperation(
        'PUT',
        'path',
        async ({ request, response, options, project, params }, submodule) => {
          writeJson(
            response,
            200,
            BackendCommitMarkWriteResponseSchema.parse(
              await options.gitService!.setCommitMark(project, params.sha!, {
                ...(await readCommitMarkWriteRequest(request)),
                submodule,
              }),
            ),
          )
        },
      ),
      DELETE: gitOperation(
        'DELETE',
        'path',
        async ({ response, options, project, params }, submodule) => {
          writeJson(
            response,
            200,
            BackendCommitMarkDeleteResponseSchema.parse(
              await options.gitService!.deleteCommitMark(project, params.sha!, { submodule }),
            ),
          )
        },
      ),
    },
  },
  {
    key: BACKEND_CODE_PREVIEW_ROUTE,
    query: projectQuery({ url: required((value) => value.length <= 4096) }),
    operations: {
      GET: gitOperation('GET', 'query', async ({ response, options, project, search }) => {
        writeJson(
          response,
          200,
          BackendCodePreviewResponseSchema.parse(
            await options.gitService!.codePreview(project, search.get('url')!),
          ),
        )
      }),
    },
  },
]

function streamErrors(error: unknown): HttpError | null {
  if (error instanceof BackendStreamDeadlineError) {
    return httpError(504, 'UNAVAILABLE', 'Backend stream control deadline exceeded', true)
  }
  if (!(error instanceof BackendStreamServiceError)) return null
  return error.code === 'INVALID_RESOURCE'
    ? httpError(400, 'BAD_REQUEST', 'Backend stream resource is invalid')
    : error.code === 'AMBIGUOUS_RESOURCE'
      ? httpError(409, 'CONFLICT', 'Backend stream resource is ambiguous')
      : httpError(404, 'NOT_FOUND', 'Backend stream resource not found')
}

type StreamCapability = 'projects' | 'logStreaming' | 'reportAssets' | 'wikiAssets'

const streamOperation = (
  capability: StreamCapability,
  project: 'path' | 'query',
  handle: RouteOperation['handle'],
): RouteOperation =>
  op(read, {
    project,
    available: ({ project: target, options }: GateContext) =>
      target && options.streamService && options.capabilities[capability]
        ? null
        : httpError(404, 'NOT_FOUND', 'Backend stream route not found'),
    errors: streamErrors,
    failure: httpError(500, 'INTERNAL', 'Backend stream operation failed'),
    handle,
  })

/** Bound a control-plane step (resolve, list, read) by the configured deadline. */
const withDeadline = <T>(ctx: RouteContext, operation: Promise<T>) =>
  withStreamControlDeadline(operation, ctx.request, ctx.options.streamControlDeadlineMs)

const asset = (kind: 'report' | 'wiki') =>
  streamOperation(kind === 'report' ? 'reportAssets' : 'wikiAssets', 'path', async (ctx) => {
    const service = ctx.options.streamService!
    const resource = await withDeadline(
      ctx,
      kind === 'report'
        ? service.resolveReportAsset(ctx.project, ctx.params.id!, ctx.params.path!)
        : service.resolveWikiAsset(ctx.project, ctx.params.id!, ctx.params.path!),
    )
    await streamByteResource(ctx.request, ctx.response, service, resource)
  })

const resourceField = required(schemaCheck(ResourceIdSchema))

export const STREAM_ASSET_ROUTES: readonly BackendRoute[] = [
  {
    key: BACKEND_EVENTS_PATH,
    query: NO_QUERY,
    operations: {
      GET: op(
        { routeClass: 'none', readOnly: 'refuse' },
        {
          failure: httpError(500, 'INTERNAL', 'Backend request failed'),
          async handle({ request, response, options }) {
            writeEventStream(request, response, options.eventStream)
          },
        },
      ),
    },
  },
  {
    key: BACKEND_LOG_FILES_ROUTE,
    query: projectQuery({ resource: resourceField }),
    operations: {
      GET: streamOperation('projects', 'query', async (ctx) => {
        writeJson(
          ctx.response,
          200,
          BackendLogFilesResponseSchema.parse(
            await withDeadline(
              ctx,
              ctx.options.streamService!.listLogFiles(ctx.project, ctx.search.get('resource')!),
            ),
          ),
        )
      }),
    },
  },
  {
    key: BACKEND_LOG_ROUTE,
    query: projectQuery({
      resource: resourceField,
      endLine: { check: emptyOr(integerIn(/^\d{1,12}$/, 1, Number.MAX_SAFE_INTEGER)) },
      count: { check: emptyOr(integerIn(/^\d{1,4}$/, 1, 2000)) },
    }),
    operations: {
      GET: streamOperation('projects', 'query', async (ctx) => {
        const { search } = ctx
        writeJson(
          ctx.response,
          200,
          BackendLogLinesResponseSchema.parse(
            await withDeadline(
              ctx,
              ctx.options.streamService!.readLogLines(ctx.project, search.get('resource')!, {
                ...(search.get('endLine') ? { endLine: Number(search.get('endLine')) } : {}),
                ...(search.get('count') ? { count: Number(search.get('count')) } : {}),
              }),
            ),
          ),
        )
      }),
    },
  },
  {
    key: BACKEND_LOG_STREAM_ROUTE,
    query: projectQuery({ resource: resourceField }),
    operations: {
      GET: streamOperation('logStreaming', 'query', async (ctx) => {
        const resource = ctx.search.get('resource')!
        const service = ctx.options.streamService!
        await withDeadline(ctx, service.validateLogResource(ctx.project, resource))
        await streamLogEvents(ctx.request, ctx.response, service, ctx.project, resource)
      }),
    },
  },
  {
    key: BACKEND_REPORT_ASSET_ROUTE,
    params: {
      project: projectParam,
      id: parse((value) => /^R\d{4}$/.test(value)),
      path: resourceParam,
    },
    query: pathProjectQuery(),
    operations: { GET: asset('report'), HEAD: asset('report') },
  },
  {
    key: BACKEND_WIKI_ASSET_ROUTE,
    params: {
      project: projectParam,
      id: parse((value) => /^W\d{4}$/.test(value)),
      path: resourceParam,
    },
    query: pathProjectQuery(),
    operations: { GET: asset('wiki'), HEAD: asset('wiki') },
  },
]

export const BACKEND_ROUTES: readonly BackendRoute[] = [
  ...PROJECT_SHARE_ROUTES,
  ...RUN_EXPERIMENT_ROUTES,
  ...DOCUMENT_WIKI_ROUTES,
  ...GIT_ROUTES,
  ...STREAM_ASSET_ROUTES,
]
