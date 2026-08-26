import { ActorContextSchema, ProjectRefSchema } from '@memon/core'
import { describe, expect, it } from 'vitest'
import {
  authorizeBackendActor,
  BackendActorContextError,
  decodeBackendActorContext,
  MAX_BACKEND_ACTOR_CONTEXT_HEADER_BYTES,
} from './actor-context.js'

function canonicalHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decode(headerValue: string, serviceAuthenticated = true) {
  return decodeBackendActorContext({ headerValue, serviceAuthenticated })
}

function expectDecodeError(
  headerValue: string | readonly string[] | undefined,
  code: BackendActorContextError['code'],
  status: BackendActorContextError['status'],
  serviceAuthenticated = true,
): void {
  try {
    decodeBackendActorContext({ headerValue, serviceAuthenticated })
  } catch (error) {
    expect(error).toBeInstanceOf(BackendActorContextError)
    expect(error).toMatchObject({ code, status })
    if (typeof headerValue === 'string' && headerValue.length >= 16) {
      expect((error as Error).message).not.toContain(headerValue)
    }
    return
  }
  throw new Error(`expected BackendActorContextError ${code}`)
}

describe('decodeBackendActorContext', () => {
  it('decodes canonical owner and sorted viewer contexts', () => {
    expect(decode(canonicalHeader({ role: 'owner' }))).toEqual({ role: 'owner' })
    const viewer = {
      role: 'viewer',
      scopes: [
        { host: 'host-a', project: 'project-a' },
        { host: 'host-b', project: 'project-z' },
      ],
    }
    expect(decode(canonicalHeader(viewer))).toEqual(viewer)
  })

  it('requires successful service authentication before inspecting the actor header', () => {
    const valid = canonicalHeader({ role: 'owner' })
    expectDecodeError(valid, 'SERVICE_AUTH_REQUIRED', 401, false)
    expectDecodeError('not even valid base64url!', 'SERVICE_AUTH_REQUIRED', 401, false)
  })

  it('rejects missing and duplicate header values', () => {
    expectDecodeError(undefined, 'MISSING_ACTOR_CONTEXT', 400)
    expectDecodeError([], 'MISSING_ACTOR_CONTEXT', 400)
    expectDecodeError(
      [canonicalHeader({ role: 'owner' }), canonicalHeader({ role: 'owner' })],
      'INVALID_ACTOR_CONTEXT',
      400,
    )
  })

  it('rejects an over-limit wire header before decoding it', () => {
    expectDecodeError(
      'a'.repeat(MAX_BACKEND_ACTOR_CONTEXT_HEADER_BYTES + 1),
      'ACTOR_CONTEXT_TOO_LARGE',
      400,
    )
  })

  it.each([
    ['padding', `${canonicalHeader({ role: 'owner' })}=`],
    ['non-base64url character', 'abc+def'],
    ['truncated base64url', 'a'],
    ['invalid UTF-8', Buffer.from([0xff, 0xfe]).toString('base64url')],
    ['non-JSON', Buffer.from('not json').toString('base64url')],
  ])('rejects malformed %s', (_name, header) => {
    expectDecodeError(header, 'INVALID_ACTOR_CONTEXT', 400)
  })

  it.each([
    { role: 'anon' },
    { role: 'owner', scopes: [] },
    { role: 'viewer', scopes: [] },
    { role: 'viewer', scopes: [{ project: 'project-a' }] },
    { role: 'viewer', scopes: [{ host: 'Host-A', project: 'project-a' }] },
    { role: 'viewer', scopes: [{ host: 'host-a', project: 'project-a', token: 'secret' }] },
    {
      role: 'viewer',
      scopes: [
        { host: 'host-a', project: 'project-a' },
        { host: 'host-a', project: 'project-a' },
      ],
    },
  ])('rejects schema-invalid actor context: %j', (actor) => {
    expectDecodeError(canonicalHeader(actor), 'INVALID_ACTOR_CONTEXT', 400)
  })

  it('rejects valid-schema but non-canonical JSON and viewer ordering', () => {
    const whitespace = Buffer.from('{ "role": "owner" }', 'utf8').toString('base64url')
    expectDecodeError(whitespace, 'INVALID_ACTOR_CONTEXT', 400)

    const unsorted = canonicalHeader({
      role: 'viewer',
      scopes: [
        { host: 'host-b', project: 'project-a' },
        { host: 'host-a', project: 'project-a' },
      ],
    })
    expectDecodeError(unsorted, 'INVALID_ACTOR_CONTEXT', 400)

    const reversedKeys = canonicalHeader({
      scopes: [{ project: 'project-a', host: 'host-a' }],
      role: 'viewer',
    })
    expectDecodeError(reversedKeys, 'INVALID_ACTOR_CONTEXT', 400)
  })
})

describe('authorizeBackendActor', () => {
  const owner = ActorContextSchema.parse({ role: 'owner' })
  const viewer = ActorContextSchema.parse({
    role: 'viewer',
    scopes: [
      { host: 'host-a', project: 'project-a' },
      { host: 'host-b', project: 'project-b' },
    ],
  })
  const target = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })

  it.each(['read', 'mutating', 'shell'] as const)('allows owner on %s routes', (routeClass) => {
    expect(authorizeBackendActor({ actor: owner, target, routeClass })).toEqual({ ok: true })
  })

  it('allows viewer reads only for an exact Host and Project tuple', () => {
    expect(authorizeBackendActor({ actor: viewer, target, routeClass: 'read' })).toEqual({
      ok: true,
    })
    expect(
      authorizeBackendActor({
        actor: viewer,
        target: ProjectRefSchema.parse({ host: 'host-b', project: 'project-b' }),
        routeClass: 'read',
      }),
    ).toEqual({ ok: true })
  })

  it.each([
    ProjectRefSchema.parse({ host: 'host-b', project: 'project-a' }),
    ProjectRefSchema.parse({ host: 'host-a', project: 'project-b' }),
  ])('returns 403 for an equal-name Host or Project mismatch: %j', (mismatch) => {
    expect(authorizeBackendActor({ actor: viewer, target: mismatch, routeClass: 'read' })).toEqual({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'actor is not authorized for the requested Backend target',
    })
  })

  it.each(['mutating', 'shell'] as const)('returns 403 for a viewer on %s routes', (routeClass) => {
    expect(authorizeBackendActor({ actor: viewer, target, routeClass })).toMatchObject({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
    })
  })

  it('fails closed for runtime-invalid actor, target, or route class', () => {
    expect(
      authorizeBackendActor({
        actor: { role: 'viewer', scopes: [{ project: 'project-a' }] } as never,
        target,
        routeClass: 'read',
      }),
    ).toMatchObject({ ok: false, status: 403 })
    expect(
      authorizeBackendActor({
        actor: owner,
        target: { project: 'project-a' } as never,
        routeClass: 'read',
      }),
    ).toMatchObject({ ok: false, status: 403 })
    expect(
      authorizeBackendActor({ actor: owner, target, routeClass: 'admin' as never }),
    ).toMatchObject({ ok: false, status: 403 })
  })
})
