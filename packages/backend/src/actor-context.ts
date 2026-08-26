// Backend-side decoding and authorization for the actor context injected by
// central. This is a second authorization boundary after service Bearer auth:
// a valid service token alone never grants an implicit owner actor.

import { TextDecoder } from 'node:util'
import {
  type ActorContext,
  ActorContextSchema,
  type ProjectRef,
  ProjectRefSchema,
} from '@memon/core'

export const BACKEND_ACTOR_CONTEXT_HEADER = 'x-memon-actor-context'
export const MAX_BACKEND_ACTOR_CONTEXT_HEADER_BYTES = 8 * 1024

export const BACKEND_ACTOR_CONTEXT_ERROR_CODES = [
  'SERVICE_AUTH_REQUIRED',
  'MISSING_ACTOR_CONTEXT',
  'INVALID_ACTOR_CONTEXT',
  'ACTOR_CONTEXT_TOO_LARGE',
] as const

export type BackendActorContextErrorCode = (typeof BACKEND_ACTOR_CONTEXT_ERROR_CODES)[number]

export class BackendActorContextError extends Error {
  constructor(
    public readonly code: BackendActorContextErrorCode,
    public readonly status: 400 | 401,
    message: string,
  ) {
    super(message)
    this.name = 'BackendActorContextError'
  }
}

export interface DecodeBackendActorContextInput {
  /** Must be the result of the preceding service-Bearer authentication gate. */
  serviceAuthenticated: boolean
  /** Raw IncomingMessage header value; duplicate header arrays fail closed. */
  headerValue: string | readonly string[] | undefined
}

function decodeError(
  code: BackendActorContextErrorCode,
  status: 400 | 401,
  message: string,
): never {
  throw new BackendActorContextError(code, status, message)
}

function compareWireString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function canonicalActorValue(actor: ActorContext): ActorContext {
  if (actor.role === 'owner') return { role: 'owner' }
  return {
    role: 'viewer',
    scopes: [...actor.scopes]
      .map((scope) => ({ host: scope.host, project: scope.project }))
      .sort((a, b) => compareWireString(a.host, b.host) || compareWireString(a.project, b.project)),
  }
}

function encodeCanonicalActor(actor: ActorContext): string {
  return Buffer.from(JSON.stringify(canonicalActorValue(actor)), 'utf8').toString('base64url')
}

/**
 * Decode the central actor header only after service authentication succeeds.
 * The accepted representation is canonical unpadded base64url of canonical
 * JSON and is then strict-validated by the shared ActorContext schema.
 */
export function decodeBackendActorContext(input: DecodeBackendActorContextInput): ActorContext {
  if (!input.serviceAuthenticated) {
    decodeError(
      'SERVICE_AUTH_REQUIRED',
      401,
      'Backend service authentication is required before actor context',
    )
  }
  if (input.headerValue === undefined || input.headerValue.length === 0) {
    decodeError('MISSING_ACTOR_CONTEXT', 400, 'Backend actor context is required')
  }
  if (typeof input.headerValue !== 'string') {
    decodeError('INVALID_ACTOR_CONTEXT', 400, 'Backend actor context is malformed')
  }
  if (Buffer.byteLength(input.headerValue, 'ascii') > MAX_BACKEND_ACTOR_CONTEXT_HEADER_BYTES) {
    decodeError('ACTOR_CONTEXT_TOO_LARGE', 400, 'Backend actor context exceeds the header limit')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(input.headerValue)) {
    decodeError('INVALID_ACTOR_CONTEXT', 400, 'Backend actor context is malformed')
  }

  let bytes: Buffer
  let json: string
  try {
    bytes = Buffer.from(input.headerValue, 'base64url')
    // Fatal UTF-8 decoding prevents replacement characters from turning
    // different byte strings into the same parsed actor representation.
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    decodeError('INVALID_ACTOR_CONTEXT', 400, 'Backend actor context is malformed')
  }

  // Buffer's base64 decoder is intentionally lenient. Round-trip equality
  // rejects truncated/non-canonical encodings before JSON/schema processing.
  if (bytes.toString('base64url') !== input.headerValue) {
    decodeError('INVALID_ACTOR_CONTEXT', 400, 'Backend actor context is malformed')
  }

  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    decodeError('INVALID_ACTOR_CONTEXT', 400, 'Backend actor context is malformed')
  }
  const parsed = ActorContextSchema.safeParse(value)
  if (!parsed.success || encodeCanonicalActor(parsed.data) !== input.headerValue) {
    decodeError('INVALID_ACTOR_CONTEXT', 400, 'Backend actor context is malformed')
  }
  return parsed.data
}

export const BACKEND_ACTOR_ROUTE_CLASSES = ['read', 'mutating', 'shell'] as const
export type BackendActorRouteClass = (typeof BACKEND_ACTOR_ROUTE_CLASSES)[number]

export type BackendActorAuthorizationResult =
  | { ok: true }
  | {
      ok: false
      status: 403
      code: 'FORBIDDEN'
      message: 'actor is not authorized for the requested Backend target'
    }

export interface AuthorizeBackendActorInput {
  actor: ActorContext
  target: ProjectRef
  routeClass: BackendActorRouteClass
}

const FORBIDDEN: BackendActorAuthorizationResult = Object.freeze({
  ok: false,
  status: 403,
  code: 'FORBIDDEN',
  message: 'actor is not authorized for the requested Backend target',
})

/** Owner may use every route class; viewer may only read an exact tuple scope. */
export function authorizeBackendActor(
  input: AuthorizeBackendActorInput,
): BackendActorAuthorizationResult {
  const actor = ActorContextSchema.safeParse(input.actor)
  const target = ProjectRefSchema.safeParse(input.target)
  if (!actor.success || !target.success) return FORBIDDEN
  if (!(BACKEND_ACTOR_ROUTE_CLASSES as readonly string[]).includes(input.routeClass)) {
    return FORBIDDEN
  }
  if (actor.data.role === 'owner') return { ok: true }
  if (input.routeClass !== 'read') return FORBIDDEN
  return actor.data.scopes.some(
    (scope) => scope.host === target.data.host && scope.project === target.data.project,
  )
    ? { ok: true }
    : FORBIDDEN
}
