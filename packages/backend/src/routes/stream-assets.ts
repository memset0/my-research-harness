// Instance events, log files / lines / streams, and Report / Wiki byte assets.

import {
  BackendLogFilesResponseSchema,
  BackendLogLinesResponseSchema,
  ResourceIdSchema,
} from '@memon/core'
import {
  BACKEND_EVENTS_PATH,
  BACKEND_LOG_FILES_ROUTE,
  BACKEND_LOG_ROUTE,
  BACKEND_LOG_STREAM_ROUTE,
  BACKEND_REPORT_ASSET_ROUTE,
  BACKEND_WIKI_ASSET_ROUTE,
} from '../http/paths.js'
import {
  type BackendRoute,
  type GateContext,
  type HttpError,
  httpError,
  type RouteContext,
  type RouteOperation,
} from '../http/pipeline.js'
import { writeJson } from '../http/respond.js'
import {
  BackendStreamDeadlineError,
  streamByteResource,
  streamLogEvents,
  withStreamControlDeadline,
  writeEventStream,
} from '../http/streaming.js'
import { BackendStreamServiceError } from '../stream-service.js'
import {
  emptyOr,
  integerIn,
  NO_QUERY,
  op,
  parse,
  pathProjectQuery,
  projectParam,
  projectQuery,
  read,
  required,
  resourceParam,
  schemaCheck,
} from './shared.js'

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
