import type { AddressInfo } from 'node:net'
import type { BackendCapabilities } from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { BackendEventStream } from './event-stream.js'
import { BackendMutationError, type BackendMutationService } from './mutation-service.js'
import { createBackendServer } from './server.js'

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
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
const servers: ReturnType<typeof createBackendServer>[] = []
afterEach(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((done) => server.close(() => done()))),
  )
  servers.length = 0
})
const context = (role: 'owner' | 'viewer') =>
  Buffer.from(
    JSON.stringify(
      role === 'owner' ? { role } : { role, scopes: [{ host: 'host-a', project: 'project-a' }] },
    ),
  ).toString('base64url')
async function start(service: BackendMutationService, eventStream?: BackendEventStream) {
  const server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: TOKEN },
    capabilities: caps,
    revision: 'revision-a',
    mutationService: service,
    eventStream,
    ...(eventStream ? { instanceEpoch: eventStream.instanceEpoch } : {}),
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
function service(): BackendMutationService {
  return {
    setRunStatus: vi.fn(async () => ({
      ok: true as const,
      mtime: 2,
      prevStatus: 'PENDING',
      nextStatus: 'RUNNING',
    })),
    setRunArchived: vi.fn(),
    setExperimentStatus: vi.fn(),
    setExperimentArchived: vi.fn(),
    writeRunReadme: vi.fn(async (_project, _id, input) => ({
      ok: true as const,
      mtime: 2,
      hash: 'a'.repeat(40),
      finalContent: input.content,
      activityRecorded: false,
    })),
    writeExperimentReadme: vi.fn(async (_project, _id, input) => ({
      ok: true as const,
      mtime: 2,
      hash: 'a'.repeat(40),
      finalContent: input.content,
      activityRecorded: true,
    })),
    createExperiment: vi.fn(async () => ({
      ok: true as const,
      id: 'E0001-created',
      resource: 'docs/experiments/E0001-created/README.md',
      mtime: 2,
      hash: 'a'.repeat(40),
    })),
    bindExperiment: vi.fn(async () => ({
      ok: true as const,
      experimentId: 'E0001-created',
      runId: 'run-a',
      experimentMtime: 2,
      experimentHash: 'a'.repeat(40),
      runMtime: 2,
      runHash: 'b'.repeat(40),
    })),
    deleteExperiment: vi.fn(async () => ({
      ok: true as const,
      deletedId: 'E0001-created',
      cascadedRuns: [],
    })),
    mutateWarning: vi.fn(async () => ({
      ok: true as const,
      warnings: [],
      mtime: 2,
      hash: 'a'.repeat(40),
      rowId: 'w_aaaaaaaaaaaa',
    })),
    listWarnings: vi.fn(async () => ({
      warnings: [],
      mtime: 2,
      hash: 'a'.repeat(40),
    })),
  }
}
async function call(
  origin: string,
  path: string,
  method: string,
  body?: unknown,
  role: 'owner' | 'viewer' = 'owner',
) {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      [BACKEND_ACTOR_CONTEXT_HEADER]: context(role),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('Backend mutation route family', () => {
  it('requires exact owner Host/Project and dispatches strict run status', async () => {
    const s = service()
    const stream = new BackendEventStream({
      instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
    })
    const origin = await start(s, stream)
    expect(
      (
        await call(
          origin,
          '/api/backend/v1/runs/run-a/status?project=project-a',
          'PATCH',
          { status: 'RUNNING', expectedMtime: 1 },
          'viewer',
        )
      ).status,
    ).toBe(403)
    const response = await call(
      origin,
      '/api/backend/v1/runs/run-a/status?project=project-a',
      'PATCH',
      { status: 'RUNNING', expectedMtime: 1 },
    )
    expect(response.status).toBe(200)
    expect(s.setRunStatus).toHaveBeenCalledWith('project-a', 'run-a', {
      status: 'RUNNING',
      expectedMtime: 1,
    })
    expect(stream.currentSequence).toBe(1)
  })
  it('rejects the retired manual journal append route', async () => {
    const s = service()
    const stream = new BackendEventStream({
      instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
    })
    const origin = await start(s, stream)
    const response = await call(
      origin,
      '/api/backend/v1/journal/append?project=project-a',
      'POST',
      { tag: 'NOTE', body: 'safe' },
    )
    expect(response.status).toBe(404)
    expect(stream.currentSequence).toBe(0)
  })
  it('returns bounded path-free conflict without retry', async () => {
    const s = service()
    s.setRunStatus = vi.fn(async () => {
      throw new BackendMutationError('CONFLICT', 'Document changed', {
        mtime: 2,
        hash: 'a'.repeat(40),
        content: 'current',
      })
    })
    const origin = await start(s)
    const response = await call(
      origin,
      '/api/backend/v1/runs/run-a/status?project=project-a',
      'PATCH',
      { status: 'RUNNING', expectedMtime: 1 },
    )
    expect(response.status).toBe(409)
    const payload = (await response.json()) as Record<string, unknown>
    const body = JSON.stringify(payload)
    expect(payload).toHaveProperty('currentHash')
    expect(payload).not.toHaveProperty('content')
    expect(body).not.toContain('path')
    expect(s.setRunStatus).toHaveBeenCalledOnce()
  })

  it('serves viewer warning reads and strictly dispatches owner warning writes', async () => {
    const s = service()
    const stream = new BackendEventStream({
      instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
    })
    const origin = await start(s, stream)
    const list = await call(
      origin,
      '/api/backend/v1/runs/run-a/warnings?project=project-a',
      'GET',
      undefined,
      'viewer',
    )
    expect(list.status).toBe(200)
    expect(s.listWarnings).toHaveBeenCalledWith('run', 'project-a', 'run-a')

    const input = {
      category: 'other',
      message: 'check this',
      expectedMtime: 1,
      expectedHash: 'a'.repeat(40),
    }
    const add = await call(
      origin,
      '/api/backend/v1/runs/run-a/warnings?project=project-a',
      'POST',
      input,
    )
    expect(add.status).toBe(200)
    expect(await add.json()).toMatchObject({ ok: true, warnings: [] })
    expect(s.mutateWarning).toHaveBeenCalledWith('run', 'project-a', 'run-a', {
      op: 'add',
      ...input,
      rowId: undefined,
    })

    const invalid = await call(
      origin,
      '/api/backend/v1/runs/run-a/warnings?project=project-a',
      'POST',
      { ...input, unexpected: true },
    )
    expect(invalid.status).toBe(400)
    expect(s.mutateWarning).toHaveBeenCalledOnce()
    expect(stream.currentSequence).toBe(1)
  })

  it('dispatches strict Experiment lifecycle mutations and publishes committed events', async () => {
    const s = service()
    const stream = new BackendEventStream({
      instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
      now: () => '2026-08-26T00:00:00.000Z',
    })
    const frames: string[] = []
    const unsubscribe = stream.subscribe((frame) => {
      frames.push(frame)
      return true
    })
    const origin = await start(s, stream)
    const createInput = { slug: 'created', title: 'Created' }
    expect(
      (
        await call(
          origin,
          '/api/backend/v1/experiments?project=project-a',
          'POST',
          createInput,
          'viewer',
        )
      ).status,
    ).toBe(403)
    expect(stream.currentSequence).toBe(0)
    expect(
      (await call(origin, '/api/backend/v1/experiments?project=project-a', 'POST', createInput))
        .status,
    ).toBe(200)
    const bindInput = {
      run: 'run-a',
      expectedMtime: 1,
      expectedHash: 'a'.repeat(40),
      expectedRunMtime: 1,
      expectedRunHash: 'b'.repeat(40),
    }
    expect(
      (
        await call(
          origin,
          '/api/backend/v1/experiments/E0001-created/link?project=project-a',
          'POST',
          bindInput,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await call(
          origin,
          '/api/backend/v1/experiments/E0001-created?project=project-a&force=false',
          'DELETE',
          { expectedMtime: 2, expectedHash: 'a'.repeat(40), runLocks: [] },
        )
      ).status,
    ).toBe(200)

    expect(s.createExperiment).toHaveBeenCalledWith('project-a', createInput)
    expect(s.bindExperiment).toHaveBeenCalledWith('link', 'project-a', 'E0001-created', bindInput)
    expect(s.deleteExperiment).toHaveBeenCalledOnce()
    expect(stream.currentSequence).toBe(7)
    const serialized = frames.join('\n')
    expect(serialized).toContain('"topic":"experiment-change"')
    expect(serialized).toContain('"topic":"run-change"')
    expect(serialized).toContain('"topic":"journal-change"')
    expect(serialized).toContain('"project":"project-a"')
    unsubscribe()
  })

  it('does not publish when the provider rejects before commit', async () => {
    const s = service()
    s.createExperiment = vi.fn(async () => {
      throw new BackendMutationError('CONFLICT', 'Document changed', {
        mtime: 2,
        hash: 'a'.repeat(40),
        content: 'private',
      })
    })
    const stream = new BackendEventStream({
      instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
    })
    const origin = await start(s, stream)
    const response = await call(origin, '/api/backend/v1/experiments?project=project-a', 'POST', {
      slug: 'created',
    })
    expect(response.status).toBe(409)
    expect(await response.json()).not.toHaveProperty('content')
    expect(stream.currentSequence).toBe(0)
  })
})
