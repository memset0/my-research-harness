import 'server-only'

import { isRunDirName, isRunPath } from '@memon/core'
import { NextResponse } from 'next/server'

/**
 * A Run route id is a Run directory name (`<slug>-<YYMMDD>-<HHMMSS>`) or a
 * safe project-relative Run path (`logs|outputs|experiments/…/<run-dir>`);
 * neither may contain a backslash or NUL.
 * Anything else — an encoded traversal such as `..%2Fetc` included — is
 * rejected before any project, runtime-index or filesystem lookup.
 */
export function isValidRunRouteId(id: string): boolean {
  return (isRunDirName(id) && !/[\\\0]/.test(id)) || isRunPath(id)
}

export function invalidRunIdResponse(id: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'INVALID_RESOURCE',
        message: `run id "${id}" is not a Run directory name or project-relative Run path`,
      },
    },
    { status: 400 },
  )
}

type RunRouteContext<P extends { id: string }> = { params: Promise<P> }

/** Wrap a `/api/runs/[id]/**` handler with the Run id shape check. */
export function withValidRunId<P extends { id: string }, R extends Request>(
  handler: (request: R, context: RunRouteContext<P>) => Promise<Response> | Response,
) {
  return async (request: R, context: RunRouteContext<P>): Promise<Response> => {
    const params = await context.params
    if (!isValidRunRouteId(params.id)) return invalidRunIdResponse(params.id)
    return handler(request, { params: Promise.resolve(params) })
  }
}
