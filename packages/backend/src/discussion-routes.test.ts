import type { Server } from 'node:http'
import {
  type ActorContext,
  ActorContextSchema,
  type ProjectConfig,
  publishDiscussionCatalog,
} from '@memon/core'
import {
  actorHeader,
  createBackendRequest,
  createTempProject,
  removeTempDirs,
  startBackend,
} from '@memon/test-utils'
import { afterEach, expect, it } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { FilesystemDocumentService } from './document-service.js'
import { BackendEventStream } from './event-stream.js'
import { createBackendServer } from './server.js'

const servers = new Set<Server>()
afterEach(async () => {
  for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()))
  servers.clear()
  await removeTempDirs()
})
it('serves registered published discussions, rejects drafts, stale answers and viewer writes', async () => {
  const source =
    '---\ntitle: Design\nstatus: OPEN\n---\n## Storage\n```question\nid: STORE\ntype: text\ncategory: design\nstatus: OPEN\n```\n\nEvidence.\n'
  const p = await createTempProject({
    files: {
      '.memon/project.yml': 'schema_version: 1\n',
      'docs/discussions/D0001-design/README.md': source,
      'docs/discussions/D0002-draft/README.md': source.replace('status: OPEN', 'status: DRAFT'),
    },
  })
  await publishDiscussionCatalog(p.root)
  const projects = [
    { name: 'project-a', root: p.root, include: [], exclude: [], storage: 'local' },
  ] satisfies ProjectConfig[]
  const token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: token },
    capabilities: {
      projects: true,
      mutations: true,
      events: true,
      logStreaming: true,
      reportAssets: true,
      wikiAssets: true,
      git: false,
      shares: false,
      slurm: false,
    },
    instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
    documentService: new FilesystemDocumentService(projects),
    eventStream: new BackendEventStream({ instanceEpoch: '123e4567-e89b-42d3-a456-426614174000' }),
  })
  const origin = await startBackend(server, servers)
  const request = createBackendRequest<ActorContext>({
    origin: () => origin,
    token,
    actorHeaderName: BACKEND_ACTOR_CONTEXT_HEADER,
  })
  const owner = ActorContextSchema.parse({ role: 'owner' })
  const viewer = ActorContextSchema.parse({
    role: 'viewer',
    scopes: [{ host: 'host-a', project: 'project-a' }],
  })
  const path = '/api/backend/v1/discussions/D0001?project=project-a'
  const first = await request(path, { actor: owner })
  const validator = first.headers.get('etag') ?? 'W/"prior-version"'
  expect(first.status).toBe(200)
  const doc = (await first.json()) as { questions: { snapshot: string }[] }
  expect(
    (await request('/api/backend/v1/discussions/D0002?project=project-a', { actor: owner })).status,
  ).toBe(404)
  const answerPath = '/api/backend/v1/discussions/D0001/responses?project=project-a'
  expect(
    (
      await request(answerPath, {
        actor: owner,
        method: 'POST',
        body: {
          question: 'STORE',
          snapshot: doc.questions[0]!.snapshot,
          answer: { text: 'Files' },
        },
      })
    ).status,
  ).toBe(200)
  const refreshed = await fetch(`${origin}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      [BACKEND_ACTOR_CONTEXT_HEADER]: actorHeader(owner),
      'if-none-match': validator,
    },
  })
  expect(refreshed.status).toBe(200)
  const updated = (await refreshed.json()) as { events: unknown[] }
  expect(updated.events).toHaveLength(1)
  expect(
    (
      await request(answerPath, {
        actor: viewer,
        method: 'POST',
        body: {
          question: 'STORE',
          snapshot: doc.questions[0]!.snapshot,
          answer: { text: 'Forbidden' },
        },
      })
    ).status,
  ).toBeGreaterThanOrEqual(400)
  expect(
    (
      await request(answerPath, {
        actor: owner,
        method: 'POST',
        body: {
          question: 'STORE',
          snapshot: `sha256:${'0'.repeat(64)}`,
          answer: { text: 'Files' },
        },
      })
    ).status,
  ).toBe(409)
})
