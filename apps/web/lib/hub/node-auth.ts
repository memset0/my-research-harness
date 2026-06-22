// Authenticate a node's WS handshake by its per-node Bearer token against the
// hub's registered nodes. Constant-time compare (reuses the single-user trust
// model from lib/auth/basic-auth.ts). See add-hub-node-split (hub-node-transport).

import { timingSafeEqual } from 'node:crypto'
import type { HubConfig } from '@memon/core'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Returns the matching node name for a valid `Authorization: Bearer <token>`
 * header, or null. Checks every registered node (no early-return) so timing
 * does not leak which token matched.
 */
export function authenticateNodeToken(
  authHeader: string | undefined,
  hub: HubConfig,
): string | null {
  if (!authHeader) return null
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  if (!m) return null
  const token = m[1]!
  let matched: string | null = null
  for (const n of hub.nodes) {
    if (safeEqual(token, n.authToken)) matched = n.name
  }
  return matched
}
