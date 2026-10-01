// Reports, code reviews, READMEs, Wiki pages and Wiki review marks.

import {
  BackendCodeReviewResponseSchema,
  BackendCodeReviewsResponseSchema,
  BackendDocumentWriteRequestSchema,
  BackendExperimentResponseSchema,
  BackendReadmeMutationResponseSchema,
  BackendReadmeResponseSchema,
  BackendReportResponseSchema,
  BackendReportsResponseSchema,
  BackendResourceInventoryResponseSchema,
  BackendRunResponseSchema,
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
  WikiReviewError,
  WikiReviewOrderError,
} from '@memon/core'
import { BackendDocumentServiceError } from '../document-service.js'
import {
  BACKEND_CODE_REVIEW_ROUTE,
  BACKEND_CODE_REVIEWS_ROUTE,
  BACKEND_EXPERIMENT_README_ROUTE,
  BACKEND_README_ROUTE,
  BACKEND_REPORT_ROUTE,
  BACKEND_REPORTS_ROUTE,
  BACKEND_RUN_README_ROUTE,
  BACKEND_WIKI_BACKLINKS_ROUTE,
  BACKEND_WIKI_PAGE_ROUTE,
  BACKEND_WIKI_REVIEW_MARK_ROUTE,
  BACKEND_WIKI_REVIEW_ROUTE,
  BACKEND_WIKI_ROUTE,
  MAX_BACKEND_CONTROL_JSON_BYTES,
  MAX_BACKEND_DOCUMENT_BODY_BYTES,
} from '../http/paths.js'
import {
  type BackendRoute,
  type HttpError,
  httpError,
  type RouteContext,
  type RouteOperation,
} from '../http/pipeline.js'
import {
  BackendControlBodyError,
  readBoundedJsonRequest,
  readCodeReviewPatchRequest,
  readDocumentWriteRequest,
  writeJson,
} from '../http/respond.js'
import { BackendMutationError } from '../mutation-service.js'
import { BackendProjectServiceError } from '../project-service.js'
import {
  codeReviewIdParam,
  controlShell,
  inventoryField,
  mutating,
  mutationConflict,
  mutationErrorStatus,
  op,
  projectQuery,
  publishJournalChange,
  read,
  reportIdParam,
  required,
  requireProject,
  resourceParam,
  schemaCheck,
  selectedReadmeResource,
  shell,
  wikiArtifactParam,
  wikiIdParam,
  wikiShaParam,
  writeCodeReviewResult,
  writeDocumentResult,
} from './shared.js'

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
