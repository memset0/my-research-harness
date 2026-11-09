import {
  DiscussionError,
  DiscussionResponseInputSchema,
  DiscussionStatusInputSchema,
} from '@memon/core'
import { BACKEND_API_PREFIX } from '../http/paths.js'
import { type BackendRoute, httpError } from '../http/pipeline.js'
import { readBoundedJsonRequest, writeJson } from '../http/respond.js'
import { editMutating, op, parse, projectQuery, read, requireProject } from './shared.js'

const idParam = parse((v) => /^D\d{4}$/.test(v))
const failure = httpError(500, 'INTERNAL', 'Discussion operation failed')
const responseInput = DiscussionResponseInputSchema
const statusInput = DiscussionStatusInputSchema
function validated<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value)
  } catch (error) {
    throw new DiscussionError('BAD_REQUEST', String(error))
  }
}
export const DISCUSSION_ROUTES: readonly BackendRoute[] = [
  {
    key: `${BACKEND_API_PREFIX}/discussions`,
    query: projectQuery(),
    operations: {
      GET: op(read, {
        project: 'query',
        available: requireProject(({ options }) => !!options.documentService?.listDiscussions),
        failure,
        handle: async (ctx) => {
          writeJson(
            ctx.response,
            200,
            await ctx.options.documentService!.listDiscussions!(ctx.project!),
          )
        },
      }),
    },
  },
  {
    key: `${BACKEND_API_PREFIX}/discussions/[id]`,
    params: { id: idParam },
    query: projectQuery(),
    operations: {
      GET: op(read, {
        project: 'query',
        available: requireProject(({ options }) => !!options.documentService?.getDiscussion),
        failure,
        handle: async (ctx) => {
          writeJson(
            ctx.response,
            200,
            await ctx.options.documentService!.getDiscussion!(ctx.project!, ctx.params.id!),
          )
        },
      }),
    },
  },
  {
    key: `${BACKEND_API_PREFIX}/discussions/[id]/responses`,
    params: { id: idParam },
    query: projectQuery(),
    operations: {
      POST: op(editMutating, {
        project: 'query',
        available: requireProject(({ options }) => !!options.documentService?.respondDiscussion),
        failure,
        handle: async ({ request, response, options, project, params }) => {
          const input = validated(responseInput, await readBoundedJsonRequest(request, 8192))
          writeJson(
            response,
            200,
            await options.documentService!.respondDiscussion!(project!, params.id!, input),
          )
        },
      }),
    },
  },
  {
    key: `${BACKEND_API_PREFIX}/discussions/[id]/status`,
    params: { id: idParam },
    query: projectQuery(),
    operations: {
      POST: op(editMutating, {
        project: 'query',
        available: requireProject(({ options }) => !!options.documentService?.setDiscussionStatus),
        failure,
        handle: async ({ request, response, options, project, params }) => {
          const input = validated(statusInput, await readBoundedJsonRequest(request, 4096))
          writeJson(
            response,
            200,
            await options.documentService!.setDiscussionStatus!(project!, params.id!, input),
          )
        },
      }),
    },
  },
]
