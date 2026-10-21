// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('./lib/server/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('./lib/server/central/central-shares', () => ({ validateCentralShare: vi.fn() }))
vi.mock('./lib/server/standalone-services', () => ({ standaloneServices: vi.fn() }))

import { signSharesCookie } from './lib/server/auth/cookies'
import { __resetForTests } from './lib/server/auth/rate-limit'
import { getRuntime } from './lib/server/runtime'
import { shareRegistryFor } from './lib/server/share-registry'
import { standaloneServices } from './lib/server/standalone-services'
import { middleware } from './middleware'

const SECRET = 'central-session-secret'
let directory: string
const getRun = vi.fn()

beforeEach(async () => {
  __resetForTests()
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'memon-document-share-'))
  vi.mocked(getRuntime).mockResolvedValue({
    configPath: join(directory, 'config.yml'),
    auth: { username: 'admin', password: 'owner', sessionSecret: SECRET },
    config: { central: { hosts: [] }, projects: [] },
    index: { get: () => undefined },
    experiments: new Map(),
    reportsCache: { getList: () => [] },
    projectFor: () => null,
    reportsDir: () => null,
    digestsDir: () => null,
  } as never)
  vi.mocked(standaloneServices).mockReturnValue({
    shares: { validate: vi.fn().mockResolvedValue(false) },
    projects: { getRun },
  } as never)
})
afterEach(async () => {
  __resetForTests()
  await rm(directory, { recursive: true, force: true })
})

async function viewerFor(
  scope: Parameters<ReturnType<typeof shareRegistryFor>['create']>[0]['scope'],
) {
  const record = await shareRegistryFor(join(directory, 'config.yml')).create({
    host: 'host-a',
    project: 'project-x',
    scope,
  })
  const cookie = signSharesCookie(
    [{ host: 'host-a', project: 'project-x', token: record.token }],
    SECRET,
  )
  return (path: string) =>
    middleware(
      new NextRequest(`https://memon.example.test${path}`, {
        headers: { cookie: `memon-shares=${cookie}`, 'x-forwarded-for': '203.0.113.81' },
      }),
    )
}

const allowed = (response: Response) => response.headers.get('x-middleware-next') === '1'

describe('middleware document-scoped shares', () => {
  it('admits the shared page and its reads and denies the rest of the Project', async () => {
    const open = await viewerFor({ kind: 'wiki', id: 'W0004' })
    const page = await open('/h/host-a/p/project-x/wiki/W0004')
    expect(allowed(page)).toBe(true)
    const forwardedScope = page.headers.get('x-middleware-request-x-memon-host-scope')
    expect(forwardedScope).toBeTruthy()
    expect(JSON.parse(Buffer.from(forwardedScope!, 'base64url').toString('utf8'))).toEqual([
      { host: 'host-a', project: 'project-x' },
    ])
    expect(page.headers.get('x-middleware-request-x-memon-doc-scope')).toBeTruthy()

    expect(allowed(await open('/api/wiki/W0004?host=host-a&project=project-x'))).toBe(true)
    for (const path of [
      '/h/host-a/p/project-x/wiki/W0001',
      '/h/host-a/p/project-x',
      '/api/wiki/W0001?host=host-a&project=project-x',
      '/api/reports?host=host-a&project=project-x',
    ]) {
      const response = await open(path)
      expect(response.status).toBe(403)
    }
  })

  it('admits Runs of the shared Experiment only after resolving their directory', async () => {
    const open = await viewerFor({ kind: 'experiment', id: 'E0001-pipeline' })
    getRun.mockResolvedValueOnce({ resource: 'logs/E0001/V0001/run-1' })
    expect(allowed(await open('/api/runs/run-1?host=host-a&project=project-x'))).toBe(true)
    getRun.mockResolvedValueOnce({ resource: 'logs/E0002/V0001/run-9' })
    expect((await open('/api/runs/run-9?host=host-a&project=project-x')).status).toBe(403)
    getRun.mockRejectedValueOnce(new Error('missing'))
    expect((await open('/api/runs/run-0?host=host-a&project=project-x')).status).toBe(403)
  })

  it('keeps Project-scoped links unchanged', async () => {
    const open = await viewerFor({ kind: 'project' })
    expect(allowed(await open('/h/host-a/p/project-x/wiki/W0001'))).toBe(true)
    expect(allowed(await open('/api/reports?host=host-a&project=project-x'))).toBe(true)
  })
})
