import 'server-only'

// Route params of the canonical `/<host>/<project>/…` pages. Anything that is
// not a routable Host, a valid Project name or a canonical number is a 404;
// padded and prefixed numbers were already redirected by the middleware.

import { type ProjectRef, ProjectRefSchema } from '@memon/core'
import { notFound } from 'next/navigation'
import { isRoutableHost } from '../project-routes'

export interface ProjectPageParams {
  host: string
  project: string
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    notFound()
  }
}

/** The Host-qualified Project of a canonical page, or a 404. */
export function projectFromParams(params: ProjectPageParams): ProjectRef {
  const host = decoded(params.host)
  if (!isRoutableHost(host)) notFound()
  const parsed = ProjectRefSchema.safeParse({ host, project: decoded(params.project) })
  if (!parsed.success) notFound()
  return parsed.data
}

/** A canonical number segment (`10`, never `0010`), or null. */
export function canonicalNumber(segment: string): number | null {
  return /^(?:0|[1-9]\d{0,3})$/.test(segment) ? Number(segment) : null
}

/** A canonical number segment, or a 404. */
export function numberFromParam(segment: string): number {
  const number = canonicalNumber(segment)
  if (number === null) notFound()
  return number
}
