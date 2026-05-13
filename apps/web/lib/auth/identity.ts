// Shared three-mode identity resolution for middleware AND WebSocket upgrades.
//
// The middleware (NextRequest) and the custom-server WS upgrade
// (node:http.IncomingMessage) both need to answer the same question:
//   "Who is making this request — owner, viewer, or anon?"
//
// Mode evaluation order (lazy):
//   1. Owner session cookie  (memon-session — HMAC-signed payload)
//   2. Owner HTTP Basic      (Authorization: Basic ... — config.yml plaintext)
//   3. Viewer share cookie   (memon-shares — HMAC-signed list of {project, token})
//      → ONLY evaluated when `allowViewer=true` (i.e., the route's class
//        is `read`). For `shell` / `mutating` routes the caller passes
//        `allowViewer=false` and mode 3 is skipped entirely (the share
//        cookie is not even decoded).
//
// The function does NOT consume the rate-limit token; callers must do that
// BEFORE invoking. It returns the resolved identity (or anon-with-reason)
// plus a `refundToken` flag the caller uses to decide whether to refund.

import { parseBasicAuth, verifyBasic } from './basic-auth'
import {
  OWNER_SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SHARES_COOKIE_NAME,
  signSessionCookie,
  signSharesCookie,
  verifySessionCookie,
  verifySharesCookie,
} from './cookies'
import type { ShareEntry } from './cookies'

export type IdentityRole = 'owner' | 'viewer' | 'anon'

export interface ResolvedIdentity {
  role: IdentityRole
  /** Owner: empty Set. Viewer: validated project names. Anon: empty Set. */
  scopeProjects: Set<string>
  /** True if the caller should refund the rate-limit token. */
  refundToken: boolean
  /**
   * If the owner-session cookie was used, the freshly-signed replacement
   * cookie value to set on the response (refreshing `exp`). null otherwise.
   */
  refreshedSessionCookie: string | null
  /**
   * If the share cookie was decoded and stale entries were pruned, the
   * fresh re-signed cookie value to set on the response. null if no change
   * was needed.
   */
  refreshedSharesCookie: string | null
  /**
   * If the share cookie was decoded and ALL entries are now stale, signal
   * that the cookie should be cleared on the response. (mutually exclusive
   * with `refreshedSharesCookie`.)
   */
  clearSharesCookie: boolean
}

export interface ShareValidator {
  /**
   * Validate that `token` exists in `<projectRoot(project)>/.memon/shares.json`
   * AND is not expired. Returns true on success.
   */
  validate: (project: string, token: string) => Promise<boolean>
}

export interface AuthInputs {
  /** `Authorization` header value (raw), if present. */
  authorizationHeader: string | null
  /** Parsed `memon-session` cookie value, if present. */
  sessionCookieValue: string | null
  /** Parsed `memon-shares` cookie value, if present. */
  sharesCookieValue: string | null
  /** Whether mode 3 (share cookie) may be considered for this request. */
  allowViewer: boolean
}

export interface RuntimeAuth {
  username: string
  password: string
  sessionSecret?: string
}

/**
 * Three-mode identity resolution. See file header.
 */
export async function resolveIdentity(
  inputs: AuthInputs,
  runtimeAuth: RuntimeAuth,
  shareValidator: ShareValidator,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<ResolvedIdentity> {
  const secret = runtimeAuth.sessionSecret ?? ''

  // ----- Mode 1: owner session cookie -----
  if (secret && inputs.sessionCookieValue) {
    const payload = verifySessionCookie(inputs.sessionCookieValue, secret, nowSeconds)
    if (payload) {
      // Refresh exp on every authenticated request.
      const refreshed = signSessionCookie(
        {
          v: 1,
          role: 'owner',
          iat: nowSeconds,
          exp: nowSeconds + OWNER_SESSION_TTL_SECONDS,
        },
        secret,
      )
      return {
        role: 'owner',
        scopeProjects: new Set(),
        refundToken: true,
        refreshedSessionCookie: refreshed,
        refreshedSharesCookie: null,
        clearSharesCookie: false,
      }
    }
  }

  // ----- Mode 2: owner HTTP Basic -----
  const parsed = parseBasicAuth(inputs.authorizationHeader)
  if (parsed) {
    const ok = await verifyBasic(parsed, {
      username: runtimeAuth.username,
      password: runtimeAuth.password,
    })
    if (ok) {
      return {
        role: 'owner',
        scopeProjects: new Set(),
        refundToken: true,
        refreshedSessionCookie: null,
        refreshedSharesCookie: null,
        clearSharesCookie: false,
      }
    }
  }

  // ----- Mode 3: viewer share cookie (read-class routes only) -----
  if (inputs.allowViewer && secret && inputs.sharesCookieValue) {
    const payload = verifySharesCookie(inputs.sharesCookieValue, secret)
    if (payload) {
      const validatedEntries: ShareEntry[] = []
      const validatedProjects = new Set<string>()
      for (const entry of payload.entries) {
        const ok = await shareValidator.validate(entry.project, entry.token)
        if (ok) {
          validatedEntries.push(entry)
          validatedProjects.add(entry.project)
        }
      }
      if (validatedEntries.length > 0) {
        const sameLength = validatedEntries.length === payload.entries.length
        let refreshedSharesCookie: string | null = null
        if (!sameLength) {
          // Stale entries were pruned. Re-sign the cookie with just the
          // validated subset.
          refreshedSharesCookie = signSharesCookie(validatedEntries, secret)
        }
        return {
          role: 'viewer',
          scopeProjects: validatedProjects,
          refundToken: true,
          refreshedSessionCookie: null,
          refreshedSharesCookie,
          clearSharesCookie: false,
        }
      }
      // The cookie was well-formed but no entries validated. Clear it so
      // future requests don't pay the per-entry shares.json read cost.
      return {
        role: 'anon',
        scopeProjects: new Set(),
        refundToken: false,
        refreshedSessionCookie: null,
        refreshedSharesCookie: null,
        clearSharesCookie: true,
      }
    }
  }

  // ----- Anon -----
  return {
    role: 'anon',
    scopeProjects: new Set(),
    refundToken: false,
    refreshedSessionCookie: null,
    refreshedSharesCookie: null,
    clearSharesCookie: false,
  }
}

// ----- Cookie name re-exports -----
export { SESSION_COOKIE_NAME, SHARES_COOKIE_NAME }
