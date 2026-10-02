import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ActorContextSchema,
  type BackendCapabilities,
  BackendExperimentResponseSchema,
  BackendRunResponseSchema,
  projectFs,
  withProjectFileContext,
} from '@memon/core'
import { createBackendRequest } from '@memon/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { BackendExperimentListResponseSchema } from './indexed-experiments.js'
import type { BackendMutationService } from './mutation-service.js'
import { FilesystemProjectService } from './project-service.js'
import {
  CENTRAL_READ_POLICY,
  dropProjectReadIndexes,
  invalidateProjectReadIndex,
} from './read-index.js'
import { withRequestScope } from './request-scope.js'
import { createBackendServer } from './server.js'

let root: string
const members = Array.from({ length: 5 }, (_, index) => `logs/m${index}-260101-00000${index}`)

function experimentReadme(title: string, runs: readonly string[] = members): string {
  return `---\nid: E0001-m\nslug: m\ntitle: ${title}\nstatus: OPEN\nruns: ${JSON.stringify(runs)}\n---\n## Motivation\nx\n`
}

beforeEach(async () => {
  dropProjectReadIndexes()
  root = await fs.mkdtemp(join(tmpdir(), 'memon-summary-index-'))
  await fs.mkdir(join(root, 'docs', 'experiments', 'E0001-m'), { recursive: true })
  await fs.writeFile(
    join(root, 'docs', 'experiments', 'E0001-m', 'README.md'),
    experimentReadme('A'),
  )
  for (const [index, member] of members.entries()) {
    await fs.mkdir(join(root, member), { recursive: true })
    await fs.writeFile(
      join(root, member, 'README.md'),
      `---\nstatus: FINISHED\n${index === 0 ? 'deprecated: true\n' : ''}---\n`,
    )
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  dropProjectReadIndexes()
  await fs.rm(root, { recursive: true, force: true })
})

const project = (name = 'p') => ({ name, root, include: [], exclude: [] })

describe('summary index consumers', () => {
  it('validates member eligibility with one stat per member and no README read when warm', async () => {
    const service = new FilesystemProjectService([project()])
    const cold = BackendExperimentResponseSchema.parse(await service.getExperiment('p', 'E0001-m'))
    expect(cold.deprecatedRuns).toEqual([members[0]])

    const readFile = vi.spyOn(projectFs, 'readFile')
    const stat = vi.spyOn(projectFs, 'stat')
    const realpath = vi.spyOn(projectFs, 'realpath')
    const warm = await withRequestScope(async () =>
      BackendExperimentResponseSchema.parse(await service.getExperiment('p', 'E0001-m')),
    )
    expect(warm.deprecatedRuns).toEqual([members[0]])
    const underLogs = (calls: unknown[][]) =>
      calls.map(([path]) => String(path)).filter((path) => path.includes(`${root}/logs/`))
    expect(underLogs(readFile.mock.calls)).toEqual([])
    expect(underLogs(realpath.mock.calls)).toEqual([])
    expect(underLogs(stat.mock.calls).sort()).toEqual(
      members.map((member) => join(root, member, 'README.md')).sort(),
    )
  })

  it('serves member facts within the list window and re-validates them on a manual refresh', async () => {
    const service = new FilesystemProjectService([project()], { readPolicy: CENTRAL_READ_POLICY })
    await service.getExperiment('p', 'E0001-m')
    await fs.writeFile(
      join(root, members[1]!, 'README.md'),
      '---\nstatus: FINISHED\ndeprecated: true\n---\n',
    )
    const detail = async (reason: 'open' | 'manual') =>
      BackendExperimentResponseSchema.parse(
        await withProjectFileContext({ root, storage: 'local', reason }, () =>
          service.getExperiment('p', 'E0001-m'),
        ),
      ).deprecatedRuns
    // Q1: members are list-class data, so a plain re-open inside the window
    // takes no member stat and may still show the previous facts.
    const stat = vi.spyOn(projectFs, 'stat')
    expect(await detail('open')).toEqual([members[0]])
    expect(
      stat.mock.calls.map(([path]) => String(path)).filter((path) => path.includes('/logs/')),
    ).toEqual([])
    // An explicit refresh re-takes every member fingerprint for that request.
    expect(await detail('manual')).toEqual([members[0], members[1]])
  })

  it('shows a centrally written member status on the next detail read', async () => {
    const service = new FilesystemProjectService([project('written')], {
      readPolicy: CENTRAL_READ_POLICY,
    })
    await service.getExperiment('written', 'E0001-m')
    await fs.writeFile(
      join(root, members[1]!, 'README.md'),
      '---\nstatus: FINISHED\ndeprecated: true\n---\n',
    )
    invalidateProjectReadIndex('written')
    const detail = BackendExperimentResponseSchema.parse(
      await service.getExperiment('written', 'E0001-m'),
    )
    expect(detail.deprecatedRuns).toEqual([members[0], members[1]])
  })

  it('reports malformed eligibility metadata instead of treating the Run as eligible', async () => {
    await fs.writeFile(join(root, members[2]!, 'README.md'), '---\ndeprecated: "yes"\n---\n')
    const service = new FilesystemProjectService([project()])
    await expect(service.getExperiment('p', 'E0001-m')).rejects.toMatchObject({
      code: 'INVALID_RESOURCE',
    })
  })

  it('finds the parent Experiment from indexed READMEs', async () => {
    const service = new FilesystemProjectService([project()])
    const run = BackendRunResponseSchema.parse(await service.getRun('p', members[3]!))
    expect(run.frontMatter.experiment).toBe('E0001-m')
  })

  it('reuses list observations inside the central window until invalidated', async () => {
    const service = new FilesystemProjectService([project('windowed')], {
      readPolicy: CENTRAL_READ_POLICY,
    })
    const title = async () =>
      BackendExperimentListResponseSchema.parse(await service.listExperiments('windowed'))
        .experiments[0]!.frontMatter.title
    expect(await title()).toBe('A')
    await fs.writeFile(
      join(root, 'docs', 'experiments', 'E0001-m', 'README.md'),
      experimentReadme('Changed'),
    )
    expect(await title()).toBe('A')
    invalidateProjectReadIndex('windowed')
    expect(await title()).toBe('Changed')
  })
})

describe('write invalidation in the route pipeline', () => {
  it('re-validates the Project index after a successful mutation', async () => {
    const TOKEN = 'b'.repeat(32)
    const mutationService = {
      setExperimentStatus: vi.fn(async () => {
        await fs.writeFile(
          join(root, 'docs', 'experiments', 'E0001-m', 'README.md'),
          experimentReadme('Resolved by a write'),
        )
        return { ok: true as const, mtime: 2, prevStatus: 'OPEN', nextStatus: 'RESOLVED' }
      }),
    } as unknown as BackendMutationService
    const server = createBackendServer({
      hostId: 'host-a',
      serviceTokens: { current: TOKEN },
      capabilities: {
        projects: true,
        mutations: true,
        events: false,
        logStreaming: false,
        reportAssets: false,
        wikiAssets: false,
        git: false,
        shares: false,
        slurm: false,
      } satisfies BackendCapabilities,
      revision: 'r',
      projectService: new FilesystemProjectService([project('central')], {
        readPolicy: CENTRAL_READ_POLICY,
      }),
      mutationService,
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    try {
      const request = createBackendRequest({
        origin: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        token: TOKEN,
        actorHeaderName: BACKEND_ACTOR_CONTEXT_HEADER,
      })
      const actor = ActorContextSchema.parse({ role: 'owner' })
      const list = async () =>
        BackendExperimentListResponseSchema.parse(
          await (await request('/api/backend/v1/experiments?project=central', { actor })).json(),
        ).experiments[0]!.frontMatter.title
      expect(await list()).toBe('A')
      const patch = await request('/api/backend/v1/experiments/E0001-m/status?project=central', {
        actor,
        method: 'PATCH',
        body: { status: 'RESOLVED', expectedMtime: 1 },
      })
      expect(patch.status).toBe(200)
      expect(await list()).toBe('Resolved by a write')
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
    }
  })
})
