import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import {
  type ActorContext,
  ActorContextSchema,
  BackendAnomaliesResponseSchema,
  type BackendCapabilities,
  BackendExperimentResponseSchema,
  BackendExperimentsResponseSchema,
  BackendHypothesesResponseSchema,
  BackendJournalCountResponseSchema,
  BackendJournalHistoryResponseSchema,
  BackendJournalResponseSchema,
  BackendRunResponseSchema,
  BackendResourceInventoryResponseSchema,
  BackendRunsResponseSchema,
} from '@memon/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { FilesystemProjectService } from './project-service.js'
import { createBackendServer } from './server.js'

const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const fixtureRoot = resolve(process.cwd(), '../../mock/project-a')
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

const service = new FilesystemProjectService([
  { name: 'project-a', root: fixtureRoot, include: [], exclude: [] },
  { name: 'project-copy', root: fixtureRoot, include: [], exclude: [] },
])
const server = createBackendServer({
  hostId: 'host-a',
  serviceTokens: { current: SERVICE_TOKEN },
  capabilities: CAPABILITIES,
  revision: '0123456789abcdef',
  projectService: service,
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

function actorHeader(actor: ActorContext): string {
  return Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
}

async function request(
  path: string,
  options: { actor?: ActorContext; service?: boolean; method?: string } = {},
): Promise<Response> {
  const headers = new Headers()
  if (options.service !== false) headers.set('authorization', `Bearer ${SERVICE_TOKEN}`)
  if (options.actor) headers.set(BACKEND_ACTOR_CONTEXT_HEADER, actorHeader(options.actor))
  return fetch(`${origin}${path}`, { method: options.method, headers })
}

describe('Backend initial Project data routes', () => {
  const owner = ActorContextSchema.parse({ role: 'owner' })

  it('serves every fixed read family with strict shared DTOs', async () => {
    const runsResponse = await request('/api/backend/v1/runs?project=project-a', { actor: owner })
    const runs = BackendRunsResponseSchema.parse(await runsResponse.json())
    expect(runs.runs.length).toBeGreaterThan(0)
    const runDetail = BackendRunResponseSchema.parse(
      await (
        await request(
          `/api/backend/v1/runs/${encodeURIComponent(runs.runs[0]!.id)}?project=project-a`,
          { actor: owner },
        )
      ).json(),
    )
    expect(runDetail).toMatchObject({ id: runs.runs[0]!.id, project: 'project-a' })
    expect(runDetail).not.toHaveProperty('run')
    expect(runDetail).not.toHaveProperty('path')

    const experiments = BackendExperimentsResponseSchema.parse(
      await (
        await request('/api/backend/v1/experiments?project=project-a', { actor: owner })
      ).json(),
    )
    expect(experiments.experiments.length).toBeGreaterThan(0)
    const experimentDetail = BackendExperimentResponseSchema.parse(
      await (
        await request(
          `/api/backend/v1/experiments/${encodeURIComponent(experiments.experiments[0]!.id)}?project=project-a`,
          { actor: owner },
        )
      ).json(),
    )
    expect(experimentDetail).toMatchObject({
      id: experiments.experiments[0]!.id,
      project: 'project-a',
    })
    expect(experimentDetail).not.toHaveProperty('experiment')
    expect(experimentDetail).not.toHaveProperty('path')
    BackendHypothesesResponseSchema.parse(
      await (
        await request('/api/backend/v1/hypotheses?project=project-a', { actor: owner })
      ).json(),
    )
    BackendJournalResponseSchema.parse(
      await (
        await request('/api/backend/v1/journal?project=project-a&limit=2', { actor: owner })
      ).json(),
    )
    BackendJournalCountResponseSchema.parse(
      await (
        await request('/api/backend/v1/journal?project=project-a&countOnly=1', { actor: owner })
      ).json(),
    )
    BackendAnomaliesResponseSchema.parse(
      await (await request('/api/backend/v1/anomalies?project=project-a', { actor: owner })).json(),
    )
  }, 30_000)

  it('dispatches Run and Experiment inventories through their listing-only contracts', async () => {
    const [runsResponse, experimentsResponse] = await Promise.all([
      request('/api/backend/v1/runs?project=project-a&inventory=1', { actor: owner }),
      request('/api/backend/v1/experiments?project=project-a&inventory=1', { actor: owner }),
    ])
    expect(runsResponse.status).toBe(200)
    expect(experimentsResponse.status).toBe(200)
    const runs = BackendResourceInventoryResponseSchema.parse(await runsResponse.json())
    const experiments = BackendResourceInventoryResponseSchema.parse(
      await experimentsResponse.json(),
    )
    expect(runs.items.length).toBeGreaterThan(0)
    expect(experiments.items.length).toBeGreaterThan(0)
    expect(
      (await request('/api/backend/v1/runs?project=project-a&inventory=0', { actor: owner }))
        .status,
    ).toBe(404)
  }, 30_000)

  it('requires service auth, a Project selector, and exact viewer tuple scope', async () => {
    const exactViewer = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-a', project: 'project-a' }],
    })
    const wrongHost = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-b', project: 'project-a' }],
    })
    expect(
      (await request('/api/backend/v1/runs?project=project-a', { service: false, actor: owner }))
        .status,
    ).toBe(401)
    expect((await request('/api/backend/v1/runs', { actor: owner })).status).toBe(404)
    expect(
      (await request('/api/backend/v1/runs?project=project-a', { actor: exactViewer })).status,
    ).toBe(200)
    expect(
      (await request('/api/backend/v1/runs?project=project-a', { actor: wrongHost })).status,
    ).toBe(403)
    expect(
      (await request('/api/backend/v1/runs?project=project-copy', { actor: exactViewer })).status,
    ).toBe(403)
  }, 30_000)

  it('keeps merged Journal history owner-only while the legacy read stays viewer-scoped', async () => {
    const exactViewer = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-a', project: 'project-a' }],
    })
    expect(
      (await request('/api/backend/v1/journal?project=project-a', { actor: exactViewer })).status,
    ).toBe(200)
    const denied = await request('/api/backend/v1/journal/history?project=project-a', {
      actor: exactViewer,
    })
    expect(denied.status).toBe(403)
    expect(await denied.text()).not.toContain('.memon/activity')

    const history = BackendJournalHistoryResponseSchema.parse(
      await (
        await request('/api/backend/v1/journal/history?project=project-a', { actor: owner })
      ).json(),
    )
    expect(history.project).toBe('project-a')
    expect(history.legacy.present).toBe(true)
    expect(history.invocations).toEqual([])
    // Receipt diagnostics never travel on the legacy read.
    const legacy = BackendJournalResponseSchema.parse(
      await (
        await request('/api/backend/v1/journal?project=project-a', { actor: owner })
      ).json(),
    )
    expect(legacy).not.toHaveProperty('invocations')
    expect(legacy).not.toHaveProperty('lastDigestAt')
  }, 30_000)

  it('keeps duplicate IDs Project-scoped and leaves mutations unavailable', async () => {
    const [a, copy] = await Promise.all([
      request('/api/backend/v1/runs?project=project-a', { actor: owner }),
      request('/api/backend/v1/runs?project=project-copy', { actor: owner }),
    ])
    const runsA = BackendRunsResponseSchema.parse(await a.json()).runs
    const runsCopy = BackendRunsResponseSchema.parse(await copy.json()).runs
    expect(runsCopy.some((run) => run.id === runsA[0]!.id)).toBe(true)
    expect(
      (
        await request('/api/backend/v1/runs?project=project-a', {
          actor: owner,
          method: 'POST',
        })
      ).status,
    ).toBe(404)
  }, 30_000)
})
