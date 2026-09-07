import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendExperimentResultsResponseSchema,
  BackendReadmeMutationResponseSchema,
  BackendReadmeResponseSchema,
  BackendRunFilesResponseSchema,
} from '@memon/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { FilesystemDocumentService } from './document-service.js'
import { BackendEventStream } from './event-stream.js'
import { FilesystemMutationService } from './mutation-service.js'
import { FilesystemProjectService } from './project-service.js'
import { createBackendServer } from './server.js'

const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const capabilities = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: false,
  shares: false,
  tmux: false,
  terminal: false,
  slurm: false,
  herdr: false,
} satisfies BackendCapabilities
let directory = ''
let projectRoot = ''
let origin = ''
let server: ReturnType<typeof createBackendServer>
const eventStream = new BackendEventStream({
  instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
})

beforeAll(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'memon-project-resources-'))
  projectRoot = join(directory, 'project-a')
  await fs.cp(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../mock/project-a'),
    projectRoot,
    { recursive: true },
  )
  await fs.writeFile(
    join(projectRoot, 'docs/experiments/E0001-vpred-convergence/results.yaml'),
    `schema_version: 1
columns: []
variants: []
`,
  )
  const project = { name: 'project-a', root: projectRoot, include: [], exclude: [] }
  server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: SERVICE_TOKEN },
    capabilities,
    revision: '0123456789abcdef',
    instanceEpoch: eventStream.instanceEpoch,
    eventStream,
    projectService: new FilesystemProjectService([project]),
    documentService: new FilesystemDocumentService([project]),
    mutationService: new FilesystemMutationService([project]),
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
  await fs.rm(directory, { recursive: true, force: true })
})

function actorHeader(actor: ActorContext): string {
  return Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
}

async function request(
  path: string,
  actor: ActorContext,
  options: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: options.method,
    headers: {
      authorization: `Bearer ${SERVICE_TOKEN}`,
      [BACKEND_ACTOR_CONTEXT_HEADER]: actorHeader(actor),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

describe('Backend Run files and Experiment results routes', () => {
  const owner = ActorContextSchema.parse({ role: 'owner' })

  it('returns strict, path-free resource DTOs', async () => {
    const files = BackendRunFilesResponseSchema.parse(
      await (
        await request(
          '/api/backend/v1/runs/foo-260501-100000/files?project=project-a&depth=2',
          owner,
        )
      ).json(),
    )
    const results = BackendExperimentResultsResponseSchema.parse(
      await (
        await request(
          '/api/backend/v1/experiments/E0001-vpred-convergence/results?project=project-a',
          owner,
        )
      ).json(),
    )
    expect(files.resource).toBe('logs/foo-260501-100000')
    expect(results.resource).toBe('docs/experiments/E0001-vpred-convergence/results.yaml')
    for (const payload of [files, results]) {
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain(projectRoot)
      expect(serialized).not.toMatch(/"(?:path|root|cwd|absolutePath)"\s*:/)
    }
  }, 30_000)

  it('writes an id-addressed README with optimistic locks and committed events', async () => {
    const path = '/api/backend/v1/runs/sub-recipe-260504-110000/readme?project=project-a'
    const current = BackendReadmeResponseSchema.parse(await (await request(path, owner)).json())
    const beforeSequence = eventStream.currentSequence
    const response = await request(path, owner, {
      method: 'PUT',
      body: {
        content: current.content.replace('status: FINISHED', 'status: FAILED'),
        expectedMtime: current.mtime,
        expectedHash: current.hash,
      },
    })
    const responseBody = await response.json()
    expect({ status: response.status, body: responseBody }).toMatchObject({ status: 200 })
    const updated = BackendReadmeMutationResponseSchema.parse(responseBody)
    expect(updated.finalContent).toContain('status: FAILED')
    expect(eventStream.currentSequence).toBe(beforeSequence + 2)

    const conflict = await request(path, owner, {
      method: 'PUT',
      body: {
        content: current.content,
        expectedMtime: current.mtime,
        expectedHash: current.hash,
      },
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).not.toHaveProperty('content')
    expect(eventStream.currentSequence).toBe(beforeSequence + 2)
  }, 30_000)

  it('enforces exact query grammar and exact viewer Host scope', async () => {
    const wrongHost = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-b', project: 'project-a' }],
    })
    expect(
      (
        await request(
          '/api/backend/v1/runs/foo-260501-100000/files?project=project-a&depth=7',
          owner,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await request(
          '/api/backend/v1/experiments/E0001-vpred-convergence/results?project=project-a',
          wrongHost,
        )
      ).status,
    ).toBe(403)
  }, 30_000)
})
