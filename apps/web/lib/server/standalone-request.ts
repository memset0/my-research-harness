import 'server-only'
import { createHash } from 'node:crypto'
import { getProjectFileStatus } from '@memon/core'
import { jsonResourceResponse, resourceInstanceEpoch } from './central/direct-runtime'
import { runStandaloneRequest } from './standalone-request-context'

/** Keep legacy bodies and URLs while sharing request priority, validators and freshness. */
export function withStandaloneRequest<R extends Request, A extends unknown[]>(
  handler: (request: R, ...args: A) => Promise<Response> | Response,
) {
  return (request: R, ...args: A): Promise<Response> =>
    runStandaloneRequest(request, async (scope) => {
      const response = await handler(request, ...args)
      const headers = new Headers(response.headers)
      headers.set('x-memon-epoch', resourceInstanceEpoch())
      const statuses = [...scope.projects.values()].map((project) =>
        getProjectFileStatus(project.root, scope.attentionId),
      )
      if (statuses.length) {
        const first = statuses[0]!
        const observed = statuses
          .map((status) => status.oldestVerifiedAt)
          .filter((value): value is number => value !== null)
        const status =
          statuses.length === 1
            ? first
            : {
                epoch: first.epoch,
                direct: statuses.every((item) => item.direct === true),
                oldestVerifiedAt: observed.length ? Math.min(...observed) : null,
                incomplete: statuses.some((item) => item.incomplete),
                queued: statuses.reduce((count, item) => count + item.queued, 0),
                checking: statuses.reduce((count, item) => count + item.checking, 0),
                error: statuses.find((item) => item.error)?.error ?? null,
                version: createHash('sha256')
                  .update(JSON.stringify(statuses.map((item) => item.version)))
                  .digest('hex')
                  .slice(0, 32),
              }
        headers.set('x-memon-file-status', JSON.stringify(status))
      }
      if (
        request.method === 'GET' &&
        response.status === 200 &&
        response.headers.get('content-type')?.includes('application/json')
      )
        return jsonResourceResponse(request, headers, await response.text(), response.status)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    })
}
