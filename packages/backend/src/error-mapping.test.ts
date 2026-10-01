import type { AddressInfo } from 'node:net'
import {
  AmbiguousShareError,
  type BackendCapabilities,
  JournalRecordingError,
  type JournalRecordingFailure,
  ShareNotFoundError,
  WikiReviewError,
  WikiReviewOrderError,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER, BackendActorContextError } from './actor-context.js'
import { BackendDocumentServiceError } from './document-service.js'
import { BackendGitServiceError } from './git-service.js'
import { toHttpError } from './http/errors.js'
import { BackendControlBodyError } from './http/respond.js'
import { BackendStreamDeadlineError } from './http/streaming.js'
import { BackendMutationError, type BackendMutationService } from './mutation-service.js'
import { type BackendProjectReadService, BackendProjectServiceError } from './project-service.js'
import { type BackendServerOptions, createBackendServer } from './server.js'
import { BackendStreamServiceError } from './stream-service.js'

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OWNER = Buffer.from(JSON.stringify({ role: 'owner' })).toString('base64url')
const caps: BackendCapabilities = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: false,
}

const journalFailure = new JournalRecordingError({
  invocationId: 'inv-1',
  projectRoot: '/project',
  phase: 'finish',
  outcome: 'success',
  message: 'disk full',
} as unknown as JournalRecordingFailure)

describe('toHttpError: one status per error class', () => {
  const cases: Array<[string, unknown, number, string]> = [
    [
      'body too large',
      new BackendControlBodyError(413, 'PAYLOAD_TOO_LARGE', 'x'),
      413,
      'PAYLOAD_TOO_LARGE',
    ],
    ['body invalid', new BackendControlBodyError(400, 'BAD_REQUEST', 'x'), 400, 'BAD_REQUEST'],
    [
      'actor without service auth',
      new BackendActorContextError('SERVICE_AUTH_REQUIRED', 401, 'x'),
      401,
      'UNAUTHORIZED',
    ],
    [
      'actor malformed',
      new BackendActorContextError('INVALID_ACTOR_CONTEXT', 400, 'x'),
      400,
      'BAD_REQUEST',
    ],
    ['journal recording', journalFailure, 500, 'JOURNAL_RECORD_INCOMPLETE'],
    [
      'mutation conflict',
      new BackendMutationError('CONFLICT', 'x', { mtime: 1, hash: 'a'.repeat(40), content: '' }),
      409,
      'CONFLICT',
    ],
    ['mutation bad state', new BackendMutationError('BAD_STATE', 'x'), 409, 'CONFLICT'],
    [
      'warnings not a table',
      new BackendMutationError('WARNINGS_SECTION_NOT_TABLE', 'x'),
      409,
      'CONFLICT',
    ],
    ['mutation bad request', new BackendMutationError('BAD_REQUEST', 'x'), 400, 'BAD_REQUEST'],
    ['mutation forbidden', new BackendMutationError('FORBIDDEN', 'x'), 403, 'FORBIDDEN'],
    ['mutation not found', new BackendMutationError('RESOURCE_NOT_FOUND', 'x'), 404, 'NOT_FOUND'],
    ['mutation partial', new BackendMutationError('PARTIAL', 'x'), 500, 'PARTIAL'],
    ['mutation internal', new BackendMutationError('INTERNAL', 'x'), 500, 'INTERNAL'],
    [
      'project invalid',
      new BackendProjectServiceError('INVALID_RESOURCE', 'x'),
      400,
      'BAD_REQUEST',
    ],
    [
      'project missing',
      new BackendProjectServiceError('RESOURCE_NOT_FOUND', 'x'),
      404,
      'NOT_FOUND',
    ],
    [
      'document invalid',
      new BackendDocumentServiceError('INVALID_RESOURCE', 'x'),
      400,
      'BAD_REQUEST',
    ],
    [
      'document ambiguous',
      new BackendDocumentServiceError('AMBIGUOUS_RESOURCE', 'x'),
      409,
      'CONFLICT',
    ],
    ['git invalid', new BackendGitServiceError('INVALID_RESOURCE', 'x'), 400, 'BAD_REQUEST'],
    [
      'git unavailable',
      new BackendGitServiceError('EXECUTION_UNAVAILABLE', 'x'),
      501,
      'EXECUTION_UNAVAILABLE',
    ],
    ['stream invalid', new BackendStreamServiceError('INVALID_RESOURCE', 'x'), 400, 'BAD_REQUEST'],
    ['stream ambiguous', new BackendStreamServiceError('AMBIGUOUS_RESOURCE', 'x'), 409, 'CONFLICT'],
    ['stream missing', new BackendStreamServiceError('RESOURCE_NOT_FOUND', 'x'), 404, 'NOT_FOUND'],
    ['stream deadline', new BackendStreamDeadlineError('x'), 504, 'UNAVAILABLE'],
    ['review order', new WikiReviewOrderError('a'.repeat(40)), 409, 'CONFLICT'],
    ['review unavailable', new WikiReviewError('NOT_A_REPOSITORY' as never, 'x'), 404, 'NOT_FOUND'],
    ['share missing', new ShareNotFoundError('x'), 404, 'NOT_FOUND'],
    ['share ambiguous', new AmbiguousShareError('x', []), 409, 'CONFLICT'],
  ]
  it.each(cases)('%s', (_name, error, status, code) => {
    expect(toHttpError(error)).toMatchObject({ status, code })
  })

  it('leaves unknown errors to the operation fallback', () => {
    expect(toHttpError(new Error('boom'))).toBeNull()
  })

  it('keeps the review-order and conflict bodies', () => {
    expect(toHttpError(new WikiReviewOrderError('a'.repeat(40)))?.body).toMatchObject({
      error: { code: 'REVIEW_ORDER' },
      nextSha: 'a'.repeat(40),
    })
    expect(
      toHttpError(
        new BackendMutationError('CONFLICT', 'changed', {
          mtime: 3,
          hash: 'a'.repeat(40),
          content: '',
        }),
      )?.body,
    ).toMatchObject({ error: { code: 'CONFLICT' }, currentMtime: 3, currentHash: 'a'.repeat(40) })
  })
})

const servers: ReturnType<typeof createBackendServer>[] = []
afterEach(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((done) => server.close(() => done()))),
  )
  servers.length = 0
})

async function start(options: Partial<BackendServerOptions>): Promise<string> {
  const server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: TOKEN },
    capabilities: caps,
    revision: 'revision-a',
    ...options,
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function call(origin: string, path: string, init: RequestInit = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      [BACKEND_ACTOR_CONTEXT_HEADER]: OWNER,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}

const invalid = () => {
  throw new BackendProjectServiceError('INVALID_RESOURCE', 'Experiment results are invalid')
}

describe('unified status mapping on the wire', () => {
  it('answers 400 for a malformed resource on Project reads, README and Journal history (was 422/404)', async () => {
    const projectService = {
      getRun: vi.fn(invalid),
      getExperimentResults: vi.fn(invalid),
      getJournalHistory: vi.fn(invalid),
    } as unknown as BackendProjectReadService
    const origin = await start({
      projectService,
      documentService: {} as never,
      mutationService: {} as never,
    })
    for (const path of [
      '/api/backend/v1/runs/run-a?project=project-a',
      '/api/backend/v1/experiments/E0001-a/results?project=project-a',
      '/api/backend/v1/runs/run-a/readme?project=project-a',
      '/api/backend/v1/journal/history?project=project-a',
    ]) {
      const response = await call(origin, path)
      expect(response.status, path).toBe(400)
      expect(await response.json(), path).toMatchObject({ error: { code: 'BAD_REQUEST' } })
    }
  })

  it('maps status, archive and warning mutation failures like every other mutation', async () => {
    const failing = (code: ConstructorParameters<typeof BackendMutationError>[0]) => async () => {
      throw new BackendMutationError(code, `failed with ${code}`)
    }
    const mutationService = {
      setRunStatus: vi.fn(failing('BAD_REQUEST')),
      setRunArchived: vi.fn(failing('BAD_STATE')),
      setExperimentStatus: vi.fn(failing('PARTIAL')),
      setExperimentArchived: vi.fn(async () => {
        throw journalFailure
      }),
      mutateWarning: vi.fn(failing('BAD_STATE')),
    } as unknown as BackendMutationService
    const origin = await start({ mutationService })
    const expectations: Array<[string, string, number, string]> = [
      ['PATCH', '/api/backend/v1/runs/run-a/status', 400, 'BAD_REQUEST'],
      ['PATCH', '/api/backend/v1/runs/run-a/archive', 409, 'CONFLICT'],
      ['PATCH', '/api/backend/v1/experiments/E0001-a/status', 500, 'PARTIAL'],
      ['PATCH', '/api/backend/v1/experiments/E0001-a/archive', 500, 'JOURNAL_RECORD_INCOMPLETE'],
      ['POST', '/api/backend/v1/runs/run-a/warnings', 409, 'CONFLICT'],
    ]
    for (const [method, path, status, code] of expectations) {
      const response = await call(origin, `${path}?project=project-a`, {
        method,
        body: JSON.stringify(
          method === 'POST'
            ? { category: 'data', message: 'm', expectedMtime: 1, expectedHash: 'a'.repeat(40) }
            : path.endsWith('/archive')
              ? { archived: true, expectedMtime: 1 }
              : { status: 'RUNNING', expectedMtime: 1 },
        ),
      })
      expect(response.status, path).toBe(status)
      expect(await response.json(), path).toMatchObject({ error: { code } })
    }
  })

  it('answers 413 for an oversized Run/Experiment mutation body (was 400)', async () => {
    const mutationService = {
      setRunStatus: vi.fn(),
      createExperiment: vi.fn(),
      mutateWarning: vi.fn(),
    } as unknown as BackendMutationService
    const origin = await start({ mutationService })
    const oversized = JSON.stringify({ padding: 'x'.repeat(1024 * 1024 + 16) })
    for (const [method, path] of [
      ['PATCH', '/api/backend/v1/runs/run-a/status'],
      ['POST', '/api/backend/v1/experiments'],
      ['POST', '/api/backend/v1/runs/run-a/warnings'],
    ] as const) {
      const response = await call(origin, `${path}?project=project-a`, { method, body: oversized })
      expect(response.status, path).toBe(413)
      expect(await response.json(), path).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    }
    expect(mutationService.setRunStatus).not.toHaveBeenCalled()
  })
})
