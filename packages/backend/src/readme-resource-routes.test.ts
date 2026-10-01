import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendReadmeResponseSchema,
} from '@memon/core'
import { actorHeader } from '@memon/test-utils'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { FilesystemDocumentService } from './document-service.js'
import { FilesystemProjectService } from './project-service.js'
import { createBackendServer } from './server.js'

const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const fixtureRoot = resolve(process.cwd(), '../../mock/project-a')
const project = { name: 'project-a', root: fixtureRoot, include: [], exclude: [] }
const capabilities = {
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
const server = createBackendServer({
  hostId: 'host-a',
  serviceTokens: { current: SERVICE_TOKEN },
  capabilities,
  revision: '0123456789abcdef',
  projectService: new FilesystemProjectService([project]),
  documentService: new FilesystemDocumentService([project]),
})
let origin = ''

beforeAll(async () => {
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
})

async function request(path: string, actor: ActorContext): Promise<Response> {
  return fetch(`${origin}${path}`, {
    headers: {
      authorization: `Bearer ${SERVICE_TOKEN}`,
      [BACKEND_ACTOR_CONTEXT_HEADER]: actorHeader(actor),
    },
  })
}

describe('Backend id-addressed README routes', () => {
  const owner = ActorContextSchema.parse({ role: 'owner' })

  it('returns path-free run and Experiment README DTOs directly', async () => {
    const run = BackendReadmeResponseSchema.parse(
      await (
        await request('/api/backend/v1/runs/foo-260501-100000/readme?project=project-a', owner)
      ).json(),
    )
    const experiment = BackendReadmeResponseSchema.parse(
      await (
        await request(
          '/api/backend/v1/experiments/E0001-vpred-convergence/readme?project=project-a',
          owner,
        )
      ).json(),
    )

    expect(run.resource).toBe('logs/foo-260501-100000/README.md')
    expect(experiment.resource).toBe('docs/experiments/E0001-vpred-convergence/README.md')
    for (const payload of [run, experiment]) {
      expect(JSON.stringify(payload)).not.toContain(fixtureRoot)
      expect(payload).not.toHaveProperty('path')
    }
  }, 30_000)

  it('requires an exact Project selector and exact viewer Host scope', async () => {
    const viewer = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-a', project: 'project-a' }],
    })
    const wrongHost = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-b', project: 'project-a' }],
    })
    expect((await request('/api/backend/v1/runs/foo-260501-100000/readme', owner)).status).toBe(404)
    expect(
      (await request('/api/backend/v1/runs/foo-260501-100000/readme?project=project-a', viewer))
        .status,
    ).toBe(200)
    expect(
      (await request('/api/backend/v1/runs/foo-260501-100000/readme?project=project-a', wrongHost))
        .status,
    ).toBe(403)
  }, 30_000)
})
