// Git reads, commit marks and code preview.

import {
  BackendCodePreviewResponseSchema,
  BackendCommitMarkDeleteResponseSchema,
  BackendCommitMarksResponseSchema,
  BackendCommitMarkWriteResponseSchema,
  BackendGitBranchesResponseSchema,
  BackendGitCommitResponseSchema,
  BackendGitDiffResponseSchema,
  BackendGitLogResponseSchema,
  BackendGitRangeResponseSchema,
  BackendGitStatusFilesResponseSchema,
  BackendGitStatusResponseSchema,
  BackendGitSubmodulesResponseSchema,
  ResourceIdSchema,
} from '@memon/core'
import {
  BACKEND_CODE_PREVIEW_ROUTE,
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
} from '../http/paths.js'
import {
  type BackendRoute,
  httpError,
  type RouteContext,
  type RouteOperation,
} from '../http/pipeline.js'
import { readCommitMarkWriteRequest, writeJson } from '../http/respond.js'
import type { QuerySpec } from '../http/route.js'
import {
  emptyOr,
  gitRefField,
  gitRefParam,
  integerIn,
  mutating,
  oneOf,
  op,
  pathProjectQuery,
  projectParam,
  projectQuery,
  read,
  required,
  requireProject,
  schemaCheck,
  submoduleField,
} from './shared.js'

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
