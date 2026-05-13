// Helpers for handlers to read the role / scope that middleware computed
// for the current request. Middleware sets these as request headers via
// `NextResponse.next({ request: { headers } })`; handlers retrieve them
// either from the incoming request (`req.headers`) or from `next/headers`
// for server components.

import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'

export type IdentityRole = 'owner' | 'viewer' | 'anon'

export interface RequestIdentity {
  role: IdentityRole
  scopeProjects: Set<string>
}

const ROLE_HEADER = 'x-memon-role'
const SCOPE_HEADER = 'x-memon-scope'

function parseIdentity(role: string | null | undefined, scopeRaw: string | null | undefined): RequestIdentity {
  const r: IdentityRole =
    role === 'owner' || role === 'viewer' || role === 'anon' ? role : 'anon'
  const scopeProjects = new Set<string>()
  if (scopeRaw) {
    for (const part of scopeRaw.split(',')) {
      const trimmed = part.trim()
      if (trimmed) scopeProjects.add(trimmed)
    }
  }
  return { role: r, scopeProjects }
}

/** For route-handler files that receive a NextRequest. */
export function readIdentityFromRequest(req: NextRequest | Request): RequestIdentity {
  // Both NextRequest and standard Request expose `.headers`.
  const h = req.headers
  return parseIdentity(h.get(ROLE_HEADER), h.get(SCOPE_HEADER))
}

/** For server components / actions. */
export async function readIdentityFromHeaders(): Promise<RequestIdentity> {
  const h = await headers()
  return parseIdentity(h.get(ROLE_HEADER), h.get(SCOPE_HEADER))
}
