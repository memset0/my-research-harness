// Instance metadata, Project discovery, share administration, share
// validation and Slurm status.

import {
  BACKEND_API_MAJOR,
  BackendMetadataSchema,
  BackendProjectDiscoverySchema,
  BackendProjectsResponseSchema,
  BackendShareCreateRequestSchema,
  BackendShareCreateResponseSchema,
  BackendShareListResponseSchema,
  BackendShareRevokeResponseSchema,
  BackendShareValidationRequestSchema,
  BackendShareValidationResponseSchema,
  BackendSlurmStatusSchema,
} from '@memon/core'
import { authorizeBackendActor } from '../actor-context.js'
import {
  BACKEND_META_PATH,
  BACKEND_PROJECTS_PATH,
  BACKEND_SHARE_ITEM_ROUTE,
  BACKEND_SHARE_VALIDATE_ROUTE,
  BACKEND_SHARES_ROUTE,
  BACKEND_SLURM_STATUS_ROUTE,
  MAX_BACKEND_SHARE_VALIDATION_BODY_BYTES,
} from '../http/paths.js'
import { type BackendRoute, httpError } from '../http/pipeline.js'
import {
  BackendControlBodyError,
  readBoundedJsonRequest,
  writeError,
  writeJson,
} from '../http/respond.js'
import {
  controlMutating,
  NO_QUERY,
  oneOf,
  op,
  optional,
  pathProjectQuery,
  projectParam,
  projectQuery,
  read,
  shareIdParam,
} from './shared.js'

const REQUEST_FAILED = httpError(500, 'INTERNAL', 'Backend request failed')

const shareOperation = {
  project: 'path' as const,
  available: ({ options }: { options: { capabilities: { shares: boolean } } }) =>
    options.capabilities.shares
      ? null
      : httpError(404, 'UNSUPPORTED_CAPABILITY', 'Share service is unavailable'),
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
