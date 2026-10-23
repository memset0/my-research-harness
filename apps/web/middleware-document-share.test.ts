// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('./lib/server/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('./lib/server/central/central-shares', () => ({ validateCentralShare: vi.fn() }))
vi.mock('./lib/server/share-api', () => ({ runResource: vi.fn() }))

import { signSharesCookie } from './lib/server/auth/cookies'
import { __resetForTests } from './lib/server/auth/rate-limit'
import { getRuntime } from './lib/server/runtime'
import { runResource } from './lib/server/share-api'
import { shareRegistryFor } from './lib/server/share-registry'
import { middleware } from './middleware'

const SECRET = 'central-session-secret'
let directory: string

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
    const page = await open('/host-a/project-x/w/4')
    expect(allowed(page)).toBe(true)
    const forwardedScope = page.headers.get('x-middleware-request-x-memon-host-scope')
    expect(forwardedScope).toBeTruthy()
    expect(JSON.parse(Buffer.from(forwardedScope!, 'base64url').toString('utf8'))).toEqual([
      { host: 'host-a', project: 'project-x' },
    ])
    expect(page.headers.get('x-middleware-request-x-memon-doc-scope')).toBeTruthy()

    expect(allowed(await open('/api/wiki/W0004?host=host-a&project=project-x'))).toBe(true)
    for (const path of [
      '/host-a/project-x/w/1',
      '/host-a/project-x',
      '/host-a/project-x/wiki',
      '/api/wiki/W0001?host=host-a&project=project-x',
      '/api/reports?host=host-a&project=project-x',
    ]) {
      const response = await open(path)
      expect(response.status).toBe(403)
    }
  })

  it('admits Runs of the shared Experiment only after resolving their directory', async () => {
    const open = await viewerFor({ kind: 'experiment', id: 'E0001-pipeline' })
    vi.mocked(runResource).mockResolvedValueOnce('logs/E0001/V0001/run-1')
    expect(allowed(await open('/api/runs/run-1?host=host-a&project=project-x'))).toBe(true)
    vi.mocked(runResource).mockResolvedValueOnce('logs/E0002/V0001/run-9')
    expect((await open('/api/runs/run-9?host=host-a&project=project-x')).status).toBe(403)
    vi.mocked(runResource).mockResolvedValueOnce(null)
    expect((await open('/api/runs/run-0?host=host-a&project=project-x')).status).toBe(403)
  })

  it('keeps Project-scoped links unchanged', async () => {
    const open = await viewerFor({ kind: 'project' })
    expect(allowed(await open('/host-a/project-x/w/1'))).toBe(true)
    expect(allowed(await open('/host-a/project-x/e/3/cr/2026-05-22-guard'))).toBe(true)
    expect(allowed(await open('/api/reports?host=host-a&project=project-x'))).toBe(true)
  })

  it('redeems ?share= on a page URL of its own Project only', async () => {
    const registry = shareRegistryFor(join(directory, 'config.yml'))
    const record = await registry.create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'report', id: 'R0005' },
    })
    const open = (path: string) =>
      middleware(
        new NextRequest(`https://memon.example.test${path}`, {
          headers: { 'x-forwarded-for': '203.0.113.82' },
        }),
      )
    const redeemed = await open(`/host-a/project-x/r/5?share=${record.token}&tab=1`)
    expect(redeemed.status).toBe(302)
    expect(redeemed.headers.get('location')).toBe(
      'https://memon.example.test/host-a/project-x/r/5?tab=1',
    )
    expect(redeemed.headers.get('set-cookie')).toContain('memon-shares=')
    for (const path of [
      `/host-a/project-y/r/5?share=${record.token}`,
      `/host-b/project-x/r/5?share=${record.token}`,
      '/host-a/project-x/r/5?share=not-a-valid-token-at-all',
    ]) {
      const refused = await open(path)
      expect(refused.status).toBe(404)
      expect(refused.headers.get('set-cookie')).toBeNull()
    }
  })

  it('redeems an old page link with a token after its canonical redirect', async () => {
    const record = await shareRegistryFor(join(directory, 'config.yml')).create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'report', id: 'R0005' },
    })
    const open = (path: string) =>
      middleware(
        new NextRequest(`https://memon.example.test${path}`, {
          headers: { 'x-forwarded-for': '203.0.113.84' },
        }),
      )
    const first = await open(`/h/host-a/p/project-x/reports/R0005?share=${record.token}`)
    expect(first.status).toBe(308)
    const next = new URL(first.headers.get('location')!)
    expect(`${next.pathname}${next.search}`).toBe(`/host-a/project-x/r/5?share=${record.token}`)
    const second = await open(`${next.pathname}${next.search}`)
    expect(second.status).toBe(302)
    expect(second.headers.get('location')).toBe('https://memon.example.test/host-a/project-x/r/5')
    expect(second.headers.get('set-cookie')).toContain('memon-shares=')
  })

  it('lets anyone read a public page and nothing else', async () => {
    await shareRegistryFor(join(directory, 'config.yml')).create({
      host: 'host-a',
      project: 'project-x',
      scope: { kind: 'wiki', id: 'W0004' },
      public: true,
    })
    const anonymous = (path: string, accept = 'application/json') =>
      middleware(
        new NextRequest(`https://memon.example.test${path}`, {
          headers: { accept, 'x-forwarded-for': '203.0.113.83' },
        }),
      )
    const page = await anonymous('/host-a/project-x/w/4', 'text/html')
    expect(allowed(page)).toBe(true)
    expect(page.headers.get('x-middleware-request-x-memon-role')).toBe('viewer')
    expect(page.headers.get('x-middleware-request-x-memon-document-only')).toBe('1')
    expect(allowed(await anonymous('/api/wiki/W0004?host=host-a&project=project-x'))).toBe(true)
    expect((await anonymous('/api/wiki/W0001?host=host-a&project=project-x')).status).toBe(401)
    expect((await anonymous('/api/wiki?host=host-a&project=project-x')).status).toBe(401)
    const other = await anonymous('/host-a/project-x/w/1', 'text/html')
    expect(other.status).toBe(302)
    expect(other.headers.get('location')).toContain('/login')
  })
})
