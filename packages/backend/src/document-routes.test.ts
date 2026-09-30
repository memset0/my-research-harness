import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendCodeReviewPatchResponseSchema,
  BackendCodeReviewResponseSchema,
  BackendCodeReviewsResponseSchema,
  BackendDocumentConflictResponseSchema,
  BackendDocumentWriteResponseSchema,
  BackendReadmeResponseSchema,
  BackendReportResponseSchema,
  BackendReportsResponseSchema,
  BackendResourceInventoryResponseSchema,
  type ProjectConfig,
} from '@memon/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { FilesystemDocumentService } from './document-service.js'
import { BackendEventStream } from './event-stream.js'
import { createBackendServer } from './server.js'

const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: false,
} satisfies BackendCapabilities

const CODE_REVIEW = `---
title: Route review
description: Route fixture
experiment: null
created_at: 2026-08-26T00:00:00Z
updated_at: 2026-08-26T00:00:00Z
commits:
  - repo: .
    sha: abc123
    url: https://example.test/commit/abc123
    reviewed: false
review_todolist:
  - item: verify route
    done: false
---

# Route review
`

let root = ''
let origin = ''
let server: ReturnType<typeof createBackendServer>
const eventStream = new BackendEventStream({
  instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
})

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-backend-document-routes-'))
  await Promise.all([
    fs.mkdir(join(root, 'docs', 'reports'), { recursive: true }),
    fs.mkdir(join(root, 'docs', 'digests'), { recursive: true }),
    fs.mkdir(join(root, 'docs', 'code-review'), { recursive: true }),
    fs.mkdir(join(root, 'logs', 'run-one'), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(join(root, 'docs', 'reports', 'R0001-report.md'), '# Report\n'),
    fs.writeFile(join(root, 'docs', 'digests', 'D0001-2026-08-26.md'), '# Digest\n'),
    fs.writeFile(join(root, 'docs', 'code-review', '2026-08-26-route.md'), CODE_REVIEW),
    fs.writeFile(join(root, 'logs', 'run-one', 'README.md'), '# Run\n'),
  ])
  const projects = [
    { name: 'research', root, include: [], exclude: [] },
    { name: 'research-copy', root, include: [], exclude: [] },
  ] satisfies ProjectConfig[]
  server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: SERVICE_TOKEN },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    instanceEpoch: eventStream.instanceEpoch,
    documentService: new FilesystemDocumentService(projects),
    eventStream,
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolveListen()
    })
  })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })
  await fs.rm(root, { recursive: true, force: true })
})

function actorHeader(actor: ActorContext): string {
  return Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
}

async function request(
  path: string,
  options: {
    actor?: ActorContext
    service?: boolean
    method?: string
    body?: unknown
  } = {},
): Promise<Response> {
  const headers = new Headers()
  if (options.service !== false) headers.set('authorization', `Bearer ${SERVICE_TOKEN}`)
  if (options.actor) headers.set(BACKEND_ACTOR_CONTEXT_HEADER, actorHeader(options.actor))
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  return fetch(`${origin}${path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

function expectPathFree(value: unknown): void {
  const serialized = JSON.stringify(value)
  expect(serialized).not.toContain(root)
  expect(serialized).not.toMatch(/"(?:path|root|cwd|absolutePath)"\s*:/)
}

describe('Backend document routes', () => {
  const owner = ActorContextSchema.parse({ role: 'owner' })

  it('serves every fixed read family through strict, path-free shared DTOs', async () => {
    const reports = BackendReportsResponseSchema.parse(
      await (await request('/api/backend/v1/reports?project=research', { actor: owner })).json(),
    )
    const report = BackendReportResponseSchema.parse(
      await (
        await request('/api/backend/v1/reports/R0001?project=research', { actor: owner })
      ).json(),
    )
    const reviews = BackendCodeReviewsResponseSchema.parse(
      await (
        await request('/api/backend/v1/code-reviews?project=research', { actor: owner })
      ).json(),
    )
    const reviewId = reviews.codeReviews[0]!.id
    const review = BackendCodeReviewResponseSchema.parse(
      await (
        await request(
          `/api/backend/v1/code-reviews/${encodeURIComponent(reviewId)}?project=research`,
          { actor: owner },
        )
      ).json(),
    )
    const readme = BackendReadmeResponseSchema.parse(
      await (
        await request(
          '/api/backend/v1/readme?project=research&resource=logs%2Frun-one%2FREADME.md',
          { actor: owner },
        )
      ).json(),
    )
    const duplicate = BackendReportResponseSchema.parse(
      await (
        await request('/api/backend/v1/reports/R0001?project=research-copy', { actor: owner })
      ).json(),
    )
    expect(duplicate.id).toBe(report.id)
    expect(duplicate.project).toBe('research-copy')
    expect(report).not.toHaveProperty('report')
    expect(review).not.toHaveProperty('codeReview')
    expect(readme).not.toHaveProperty('readme')
    for (const payload of [reports, report, reviews, review, readme, duplicate]) {
      expectPathFree(payload)
    }
  })

  it('dispatches document inventories without changing rich collection routes', async () => {
    const paths = [
      '/api/backend/v1/reports?project=research&inventory=1',
      '/api/backend/v1/code-reviews?project=research&inventory=1',
    ]
    const responses = await Promise.all(paths.map((path) => request(path, { actor: owner })))
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    const inventories = await Promise.all(
      responses.map(async (response) =>
        BackendResourceInventoryResponseSchema.parse(await response.json()),
      ),
    )
    expect(inventories.map(({ items }) => items.map(({ id }) => id))).toEqual([
      ['R0001'],
      ['code-review/2026-08-26-route'],
    ])
  })

  it('retires legacy Digest read and write routes even when old files exist', async () => {
    for (const path of [
      '/api/backend/v1/digests?project=research',
      '/api/backend/v1/digests/D0001?project=research',
    ]) {
      expect((await request(path, { actor: owner })).status).toBe(404)
    }
    expect(await fs.readFile(join(root, 'docs/digests/D0001-2026-08-26.md'), 'utf8')).toBe(
      '# Digest\n',
    )
  })

  it('applies strict optimistic writes and does not return current content on conflict', async () => {
    const frames: string[] = []
    const unsubscribe = eventStream.subscribe((frame) => {
      frames.push(frame)
      return true
    })
    const report = BackendReportResponseSchema.parse(
      await (
        await request('/api/backend/v1/reports/R0001?project=research', { actor: owner })
      ).json(),
    )
    const stale = await request('/api/backend/v1/reports/R0001?project=research', {
      actor: owner,
      method: 'PUT',
      body: {
        content: '# Stale\n',
        expectedMtime: report.mtime + 1,
        expectedHash: report.hash,
      },
    })
    expect(stale.status).toBe(409)
    expect(eventStream.currentSequence).toBe(0)
    const conflict = BackendDocumentConflictResponseSchema.parse(await stale.json())
    expect(conflict).not.toHaveProperty('currentContent')

    const write = await request('/api/backend/v1/reports/R0001?project=research', {
      actor: owner,
      method: 'PUT',
      body: {
        content: '# Updated route report\n',
        expectedMtime: report.mtime,
        expectedHash: report.hash,
      },
    })
    expect(write.status).toBe(200)
    BackendDocumentWriteResponseSchema.parse(await write.json())
    expect(eventStream.currentSequence).toBe(1)

    const digestWrite = await request('/api/backend/v1/digests/D0001?project=research', {
      actor: owner,
      method: 'PUT',
      body: {
        content: '# Updated route digest\n',
        expectedMtime: 1,
        expectedHash: 'a'.repeat(40),
      },
    })
    expect(digestWrite.status).toBe(404)
    expect(eventStream.currentSequence).toBe(1)

    const review = BackendCodeReviewResponseSchema.parse(
      await (
        await request(
          '/api/backend/v1/code-reviews/code-review%2F2026-08-26-route?project=research',
          { actor: owner },
        )
      ).json(),
    )
    const patch = await request(
      '/api/backend/v1/code-reviews/code-review%2F2026-08-26-route?project=research',
      {
        actor: owner,
        method: 'PATCH',
        body: {
          op: 'commit',
          sha: 'abc123',
          reviewed: true,
          expectedMtime: review.mtime,
          expectedHash: review.hash,
        },
      },
    )
    expect(patch.status).toBe(200)
    const patched = BackendCodeReviewPatchResponseSchema.parse(await patch.json())
    expect(patched.completion.reviewedCommits).toBe(1)
    expect(eventStream.currentSequence).toBe(2)

    const readme = BackendReadmeResponseSchema.parse(
      await (
        await request(
          '/api/backend/v1/readme?project=research&resource=logs%2Frun-one%2FREADME.md',
          { actor: owner },
        )
      ).json(),
    )
    const readmeWrite = await request(
      '/api/backend/v1/readme?project=research&resource=logs%2Frun-one%2FREADME.md',
      {
        actor: owner,
        method: 'PUT',
        body: {
          content: '# Updated run\n',
          expectedMtime: readme.mtime,
          expectedHash: readme.hash,
        },
      },
    )
    expect(readmeWrite.status).toBe(200)
    BackendDocumentWriteResponseSchema.parse(await readmeWrite.json())
    expect(eventStream.currentSequence).toBe(3)
    expect(frames.join('\n')).toContain('"topic":"reports-change"')
    expect(frames.join('\n')).not.toContain('"topic":"digests-change"')
    expect(frames.join('\n')).toContain('"topic":"code-reviews-change"')
    expect(frames.join('\n')).toContain('"topic":"run-change"')
    unsubscribe()
  })

  it('requires service auth, exact viewer tuple scope, fixed resources, and strict bodies', async () => {
    const exactViewer = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-a', project: 'research' }],
    })
    const wrongHost = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-b', project: 'research' }],
    })
    expect(
      (
        await request('/api/backend/v1/reports?project=research', {
          actor: owner,
          service: false,
        })
      ).status,
    ).toBe(401)
    expect((await request('/api/backend/v1/reports?project=research')).status).toBe(400)
    expect(
      (await request('/api/backend/v1/reports?project=research', { actor: exactViewer })).status,
    ).toBe(200)
    expect(
      (await request('/api/backend/v1/reports?project=research', { actor: wrongHost })).status,
    ).toBe(403)
    expect(
      (
        await request('/api/backend/v1/reports?project=research-copy', {
          actor: exactViewer,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request('/api/backend/v1/reports/R0001?project=research', {
          actor: exactViewer,
          method: 'PUT',
        })
      ).status,
    ).toBe(403)
    expect((await request('/api/backend/v1/reports', { actor: owner })).status).toBe(404)
    expect(
      (
        await request('/api/backend/v1/readme?project=research&resource=%2Fetc%2Fpasswd', {
          actor: owner,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(
          '/api/backend/v1/readme?project=research&resource=docs%2Fdigests%2FD0001-2026-08-26.md',
          { actor: owner },
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await request('/api/backend/v1/reports/R0001/extra?project=research', {
          actor: owner,
        })
      ).status,
    ).toBe(404)

    const malformed = await request('/api/backend/v1/reports/R0001?project=research', {
      actor: owner,
      method: 'PUT',
      body: {
        content: '# Invalid\n',
        expectedMtime: 1,
        expectedHash: 'not-a-sha1',
        path: root,
      },
    })
    expect(malformed.status).toBe(400)
    expectPathFree(await malformed.json())

    const duplicatePath = join(root, 'docs', 'reports', 'R0001-duplicate.md')
    await fs.writeFile(duplicatePath, '# Duplicate\n')
    try {
      expect(
        (
          await request('/api/backend/v1/reports/R0001?project=research', {
            actor: owner,
          })
        ).status,
      ).toBe(409)
    } finally {
      await fs.unlink(duplicatePath)
    }
  })
})
