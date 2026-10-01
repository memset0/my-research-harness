// The declarative Backend route table: every route's path, parameters,
// query, methods, route class, read-only policy, gate, error policy and
// handler, declared once. The request pipeline derives all routing from it.

import {
  BackendCodePreviewResponseSchema,
  BackendCodeReviewResponseSchema,
  BackendCodeReviewsResponseSchema,
  BackendCommitMarkDeleteResponseSchema,
  BackendCommitMarksResponseSchema,
  BackendCommitMarkWriteResponseSchema,
  BackendDocumentWriteRequestSchema,
  BackendExperimentResponseSchema,
  BackendGitBranchesResponseSchema,
  BackendGitCommitResponseSchema,
  BackendGitDiffResponseSchema,
  BackendGitLogResponseSchema,
  BackendGitRangeResponseSchema,
  BackendGitStatusFilesResponseSchema,
  BackendGitStatusResponseSchema,
  BackendGitSubmodulesResponseSchema,
  BackendLogFilesResponseSchema,
  BackendLogLinesResponseSchema,
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
import { BackendGitServiceError } from '../git-service.js'
import {
  BACKEND_CODE_PREVIEW_ROUTE,
  BACKEND_CODE_REVIEW_ROUTE,
  BACKEND_CODE_REVIEWS_ROUTE,
  BACKEND_EVENTS_PATH,
  BACKEND_EXPERIMENT_README_ROUTE,
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
  BACKEND_LOG_FILES_ROUTE,
  BACKEND_LOG_ROUTE,
  BACKEND_LOG_STREAM_ROUTE,
  BACKEND_README_ROUTE,
  BACKEND_REPORT_ASSET_ROUTE,
  BACKEND_REPORT_ROUTE,
  BACKEND_REPORTS_ROUTE,
  BACKEND_RUN_README_ROUTE,
  BACKEND_WIKI_ASSET_ROUTE,
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
import { PROJECT_SHARE_ROUTES } from './projects-shares.js'
import { RUN_EXPERIMENT_ROUTES } from './runs-experiments.js'
import {
  codeReviewIdParam,
  controlShell,
  emptyOr,
  gitRefField,
  gitRefParam,
  integerIn,
  inventoryField,
  mutating,
  mutationConflict,
  mutationErrorStatus,
  NO_QUERY,
  oneOf,
  op,
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
  shell,
  submoduleField,
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
