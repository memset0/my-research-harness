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

import type { ProjectRef } from '@memon/core'
import { parseBasicAuth, verifyBasic } from './basic-auth'
import { type AccountLevel, isOwnerLevel } from './capabilities'
import type { ShareEntry } from './cookies'
import {
  OWNER_SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SHARES_COOKIE_NAME,
  signSessionCookie,
  signSharesCookie,
  verifySessionCookie,
  verifySharesCookie,
} from './cookies'

export type IdentityRole = 'owner' | 'viewer' | 'anon'

/** One document a viewer may read through a document-scoped share. */
export interface ShareDocumentGrant {
  host?: string
  project: string
  kind: 'experiment' | 'wiki' | 'report'
  id: string
  /** A service link: also reaches this Report/Wiki page's live service. */
  service?: true
}

/**
 * A validated share: `true` grants the whole Project, `{document}` one
 * document, and `service` additionally that document's live service.
 */
export type ShareGrant =
  | boolean
  | { document: { kind: ShareDocumentGrant['kind']; id: string }; service?: true }

/** The signed-in account, when the request carries one. */
export interface IdentityAccount {
  id: number
  username: string
  level: AccountLevel
}

export interface ResolvedIdentity {
  role: IdentityRole
  /** Account #1 for `config.yml` credentials, a stored account, or null (share/anon). */
  account: IdentityAccount | null
  /** Owner: empty Set. Viewer: validated project names. Anon: empty Set. */
  scopeProjects: Set<string>
  /** Central viewer scopes. Legacy standalone viewers keep this empty. */
  scopeProjectRefs: ProjectRef[]
  /**
   * Admins: the Projects granted to them, where a request addressing exactly
   * one of them gets full owner reach (including writes). Empty otherwise.
   */
  ownerProjectRefs: ProjectRef[]
  /**
   * Document-scoped grants. Their Projects are NOT in `scopeProjects` /
   * `scopeProjectRefs`; middleware admits only requests targeting the document.
   */
  scopeDocuments: ShareDocumentGrant[]
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
   * Validate that `token` is an unexpired share for `{host, project}`. Returns
   * false, true (the whole Project) or `{document}` (one document only).
   */
  validate: (project: string, token: string, host?: string) => Promise<ShareGrant>
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

/** An account as identity resolution needs it. */
export interface LookedUpAccount extends IdentityAccount {
  disabled: boolean
  grants: ReadonlyArray<{
    host: string
    project: string
    document?: { kind: 'report' | 'wiki'; id: string }
  }>
  /** Admins: the Projects the super admin granted them. */
  adminProjects?: ReadonlyArray<{ host: string; project: string }>
}

export interface AccountLookup {
  byId(id: number): Promise<LookedUpAccount | null>
}

export interface RuntimeAuth {
  username: string
  password: string
  sessionSecret?: string
  /** Stored accounts; without it only account #1 (`config.yml`) authenticates. */
  accounts?: AccountLookup
}

export const SUPER_ADMIN_ACCOUNT_ID = 1

function superAdmin(username: string): IdentityAccount {
  return { id: SUPER_ADMIN_ACCOUNT_ID, username, level: 'super_admin' }
}

interface ShareCookieOutcome {
  entries: ShareEntry[]
  total: number
  projects: Set<string>
  projectRefs: ProjectRef[]
  documents: ShareDocumentGrant[]
}

async function validateShareCookie(
  value: string,
  secret: string,
  shareValidator: ShareValidator,
): Promise<ShareCookieOutcome | null> {
  const payload = verifySharesCookie(value, secret)
  if (!payload) return null
  const outcome: ShareCookieOutcome = {
    entries: [],
    total: payload.entries.length,
    projects: new Set(),
    projectRefs: [],
    documents: [],
  }
  for (const entry of payload.entries) {
    const ok = await shareValidator.validate(entry.project, entry.token, entry.host)
    if (ok && typeof ok === 'object') {
      outcome.entries.push(entry)
      outcome.documents.push({
        ...(entry.host ? { host: entry.host } : {}),
        project: entry.project,
        ...ok.document,
        ...(ok.service ? { service: true as const } : {}),
      })
    } else if (ok) {
      outcome.entries.push(entry)
      if (entry.host) {
        outcome.projectRefs.push({ host: entry.host, project: entry.project } as ProjectRef)
      } else {
        outcome.projects.add(entry.project)
      }
    }
  }
  return outcome
}

function shareCookieRefresh(outcome: ShareCookieOutcome | null, secret: string) {
  if (!outcome) return { refreshedSharesCookie: null, clearSharesCookie: false }
  if (outcome.entries.length === 0) return { refreshedSharesCookie: null, clearSharesCookie: true }
  if (outcome.entries.length === outcome.total)
    return { refreshedSharesCookie: null, clearSharesCookie: false }
  // Stale entries were pruned: re-sign with just the validated subset.
  return {
    refreshedSharesCookie: signSharesCookie(outcome.entries, secret),
    clearSharesCookie: false,
  }
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

  // ----- Mode 1: session cookie (account #1 or a stored account) -----
  if (secret && inputs.sessionCookieValue) {
    const session = verifySessionCookie(inputs.sessionCookieValue, secret, nowSeconds)
    const account: LookedUpAccount | null = !session
      ? null
      : session.uid === SUPER_ADMIN_ACCOUNT_ID
        ? { ...superAdmin(runtimeAuth.username), disabled: false, grants: [] }
        : ((await runtimeAuth.accounts?.byId(session.uid).catch(() => null)) ?? null)
    if (session && account && !account.disabled) {
      const exp = nowSeconds + OWNER_SESSION_TTL_SECONDS
      // Account #1 keeps the v1 cookie so a rollback never logs the owner out.
      const refreshed = signSessionCookie(
        account.id === SUPER_ADMIN_ACCOUNT_ID
          ? { v: 1, role: 'owner', iat: nowSeconds, exp }
          : { v: 2, uid: account.id, iat: nowSeconds, exp },
        secret,
      )
      const summary: IdentityAccount = {
        id: account.id,
        username: account.username,
        level: account.level,
      }
      if (isOwnerLevel(account.level)) {
        return {
          role: 'owner',
          account: summary,
          scopeProjects: new Set(),
          scopeProjectRefs: [],
          ownerProjectRefs: [],
          scopeDocuments: [],
          refundToken: true,
          refreshedSessionCookie: refreshed,
          refreshedSharesCookie: null,
          clearSharesCookie: false,
        }
      }
      // Admins, users and guests are read-only viewers of their granted Projects /
      // documents plus any valid share links; capabilities add the rest.
      const shares =
        inputs.allowViewer && inputs.sharesCookieValue
          ? await validateShareCookie(inputs.sharesCookieValue, secret, shareValidator)
          : null
      const projectRefs: ProjectRef[] = [...(shares?.projectRefs ?? [])]
      const documents: ShareDocumentGrant[] = [...(shares?.documents ?? [])]
      const addProject = (host: string, project: string) => {
        if (!projectRefs.some((ref) => ref.host === host && ref.project === project))
          projectRefs.push({ host, project } as ProjectRef)
      }
      if (account.level === 'admin')
        for (const granted of account.adminProjects ?? []) addProject(granted.host, granted.project)
      if (account.level === 'user') {
        for (const grant of account.grants) {
          if (grant.document)
            documents.push({ host: grant.host, project: grant.project, ...grant.document })
          else if (
            !projectRefs.some((ref) => ref.host === grant.host && ref.project === grant.project)
          )
            projectRefs.push({ host: grant.host, project: grant.project } as ProjectRef)
        }
      }
      return {
        role: 'viewer',
        account: summary,
        scopeProjects: new Set(shares?.projects ?? []),
        scopeProjectRefs: projectRefs,
        ownerProjectRefs:
          account.level === 'admin'
            ? (account.adminProjects ?? []).map(
                (granted) => ({ host: granted.host, project: granted.project }) as ProjectRef,
              )
            : [],
        scopeDocuments: documents,
        refundToken: true,
        refreshedSessionCookie: refreshed,
        ...shareCookieRefresh(shares, secret),
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
        account: superAdmin(runtimeAuth.username),
        scopeProjects: new Set(),
        scopeProjectRefs: [],
        ownerProjectRefs: [],
        scopeDocuments: [],
        refundToken: true,
        refreshedSessionCookie: null,
        refreshedSharesCookie: null,
        clearSharesCookie: false,
      }
    }
  }

  // ----- Mode 3: viewer share cookie (read-class routes only) -----
  if (inputs.allowViewer && secret && inputs.sharesCookieValue) {
    const shares = await validateShareCookie(inputs.sharesCookieValue, secret, shareValidator)
    if (shares && shares.entries.length > 0) {
      return {
        role: 'viewer',
        account: null,
        scopeProjects: shares.projects,
        scopeProjectRefs: shares.projectRefs,
        ownerProjectRefs: [],
        scopeDocuments: shares.documents,
        refundToken: true,
        refreshedSessionCookie: null,
        ...shareCookieRefresh(shares, secret),
      }
    }
    if (shares) {
      // Well-formed but nothing validated: clear it so future requests skip the registry reads.
      return {
        role: 'anon',
        account: null,
        scopeProjects: new Set(),
        scopeProjectRefs: [],
        ownerProjectRefs: [],
        scopeDocuments: [],
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
    account: null,
    scopeProjects: new Set(),
    scopeProjectRefs: [],
    ownerProjectRefs: [],
    scopeDocuments: [],
    refundToken: false,
    refreshedSessionCookie: null,
    refreshedSharesCookie: null,
    clearSharesCookie: false,
  }
}

// ----- Cookie name re-exports -----
export { SESSION_COOKIE_NAME, SHARES_COOKIE_NAME }
