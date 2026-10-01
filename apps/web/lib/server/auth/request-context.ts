// Helpers for handlers to read the role / scope that middleware computed
// for the current request. Middleware sets these as request headers via
// `NextResponse.next({ request: { headers } })`; handlers retrieve them
// either from the incoming request (`req.headers`) or from `next/headers`
// for server components.

import 'server-only'

import { type ProjectRef, ProjectRefSchema } from '@memon/core'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'

export type IdentityRole = 'owner' | 'viewer' | 'anon'

export interface RequestIdentity {
  role: IdentityRole
  scopeProjects: Set<string>
  scopeProjectRefs: ProjectRef[]
}

const ROLE_HEADER = 'x-memon-role'
const SCOPE_HEADER = 'x-memon-scope'
export const HOST_SCOPE_HEADER = 'x-memon-host-scope'

export function encodeHostScopeHeader(scopes: readonly ProjectRef[]): string {
  const parsed = scopes.map((scope) => ProjectRefSchema.parse(scope))
  return Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url')
}

function parseHostScopeHeader(value: string | null | undefined): ProjectRef[] {
  if (!value || value.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(value)) return []
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!Array.isArray(decoded) || decoded.length > 256) return []
    const parsed = decoded.map((scope) => ProjectRefSchema.parse(scope))
    const seen = new Set<string>()
    for (const scope of parsed) {
      const key = `${scope.host}\0${scope.project}`
      if (seen.has(key)) return []
      seen.add(key)
    }
    return parsed
  } catch {
    return []
  }
}

function parseIdentity(
  role: string | null | undefined,
  scopeRaw: string | null | undefined,
  hostScopeRaw: string | null | undefined,
): RequestIdentity {
  const r: IdentityRole = role === 'owner' || role === 'viewer' || role === 'anon' ? role : 'anon'
  const scopeProjects = new Set<string>()
  if (scopeRaw) {
    for (const part of scopeRaw.split(',')) {
      const trimmed = part.trim()
      if (trimmed) scopeProjects.add(trimmed)
    }
  }
  return { role: r, scopeProjects, scopeProjectRefs: parseHostScopeHeader(hostScopeRaw) }
}

/** For route-handler files that receive a NextRequest. */
export function readIdentityFromRequest(req: NextRequest | Request): RequestIdentity {
  // Both NextRequest and standard Request expose `.headers`.
  const h = req.headers
  return parseIdentity(h.get(ROLE_HEADER), h.get(SCOPE_HEADER), h.get(HOST_SCOPE_HEADER))
}

/** For server components / actions. */
export async function readIdentityFromHeaders(): Promise<RequestIdentity> {
  const h = await headers()
  return parseIdentity(h.get(ROLE_HEADER), h.get(SCOPE_HEADER), h.get(HOST_SCOPE_HEADER))
}
