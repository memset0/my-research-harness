// Run and Experiment reads, Journal reads, and Run/Experiment mutations
// (create, delete, link, status, archive, warnings).

import {
  BackendAnomaliesResponseSchema,
  BackendArchiveMutationRequestSchema,
  BackendExperimentBindRequestSchema,
  BackendExperimentBindResponseSchema,
  BackendExperimentCreateRequestSchema,
  BackendExperimentCreateResponseSchema,
  BackendExperimentDeleteRequestSchema,
  BackendExperimentDeleteResponseSchema,
  BackendExperimentResponseSchema,
  BackendExperimentResultsResponseSchema,
  BackendHypothesesResponseSchema,
  BackendJournalCountResponseSchema,
  BackendJournalHistoryResponseSchema,
  BackendJournalResponseSchema,
  BackendMutationResponseSchema,
  BackendResourceInventoryResponseSchema,
  BackendRunFilesResponseSchema,
  BackendRunResponseSchema,
  BackendRunsResponseSchema,
  BackendStatusMutationRequestSchema,
  BackendWarningMutationRequestSchema,
  BackendWarningMutationResponseSchema,
  BackendWarningsResponseSchema,
} from '@memon/core'
import { respondConditionally } from '../conditional-read.js'
import {
  BACKEND_ANOMALIES_ROUTE,
  BACKEND_EXPERIMENT_ARCHIVE_ROUTE,
  BACKEND_EXPERIMENT_LINK_ROUTE,
  BACKEND_EXPERIMENT_RESULTS_ROUTE,
  BACKEND_EXPERIMENT_ROUTE,
  BACKEND_EXPERIMENT_STATUS_ROUTE,
  BACKEND_EXPERIMENT_UNLINK_ROUTE,
  BACKEND_EXPERIMENT_WARNING_ROUTE,
  BACKEND_EXPERIMENT_WARNINGS_ROUTE,
  BACKEND_EXPERIMENTS_ROUTE,
  BACKEND_HYPOTHESES_ROUTE,
  BACKEND_JOURNAL_HISTORY_ROUTE,
  BACKEND_JOURNAL_ROUTE,
  BACKEND_RUN_ARCHIVE_ROUTE,
  BACKEND_RUN_FILES_ROUTE,
  BACKEND_RUN_ROUTE,
  BACKEND_RUN_STATUS_ROUTE,
  BACKEND_RUN_WARNING_ROUTE,
  BACKEND_RUN_WARNINGS_ROUTE,
  BACKEND_RUNS_ROUTE,
  MAX_BACKEND_CONTROL_JSON_BYTES,
} from '../http/paths.js'
import {
  type BackendRoute,
  httpError,
  type RouteContext,
  type RouteOperation,
} from '../http/pipeline.js'
import { readBoundedJsonRequest, writeError, writeJson } from '../http/respond.js'
import type { QuerySpec } from '../http/route.js'
import { BackendExperimentListResponseSchema } from '../indexed-experiments.js'
import {
  emptyOr,
  inventoryField,
  MUTATION_UNAVAILABLE,
  matches,
  mutating,
  oneOf,
  op,
  optional,
  projectQuery,
  publishJournalChange,
  read,
  requireProject,
  resourceParam,
  shell,
  warningRowParam,
} from './shared.js'

const id = { id: resourceParam }

// --- Project data reads ------------------------------------------------------

const projectRead = (
  handle: (ctx: RouteContext) => Promise<unknown>,
  /** List reads answer `If-None-Match` from the summary index (`ETag`/304). */
  conditional: (ctx: RouteContext) => boolean = () => false,
): RouteOperation =>
  op(read, {
    project: 'query',
    available: requireProject(({ options }) => options.projectService !== undefined),
    failure: httpError(500, 'INTERNAL', 'Backend Project read failed'),
    async handle(ctx) {
      if (conditional(ctx)) {
        await respondConditionally(ctx, () => handle(ctx))
        return
      }
      writeJson(ctx.response, 200, await handle(ctx))
    },
  })

const always = () => true

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

const mutationAvailable = ({ options }: Parameters<NonNullable<RouteOperation['available']>>[0]) =>
  !options.mutationService || !options.capabilities.mutations ? MUTATION_UNAVAILABLE : null

const experimentMutation = (handle: RouteOperation['handle']): RouteOperation =>
  op(mutating, {
    project: 'query',
    available: mutationAvailable,
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

const stateMutation = (kind: 'run' | 'experiment', field: 'status' | 'archive'): RouteOperation =>
  op(mutating, {
    project: 'query',
    available: mutationAvailable,
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
        : BackendExperimentListResponseSchema.parse(result)
    }, always),
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
    GET: projectRead(
      async ({ options, project }) =>
        BackendHypothesesResponseSchema.parse(await options.projectService!.getHypotheses(project)),
      always,
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
      GET: projectRead(
        async ({ options, project, search }) => {
          const service = options.projectService!
          if (search.get('countOnly') === '1' && service.getJournalCount) {
            return BackendJournalCountResponseSchema.parse(await service.getJournalCount(project))
          }
          const journal = BackendJournalResponseSchema.parse(await service.getJournal(project))
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
        },
        ({ options, search }) =>
          search.get('countOnly') === '1' && options.projectService?.getJournalCount !== undefined,
      ),
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
    GET: projectRead(
      async ({ options, project }) =>
        BackendAnomaliesResponseSchema.parse(await options.projectService!.getAnomalies(project)),
      always,
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
