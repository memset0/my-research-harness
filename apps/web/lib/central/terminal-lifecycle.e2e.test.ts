// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer as createHttpServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  addShare,
  BACKEND_API_MAJOR,
  type BackendCapabilities,
  type CentralConfig,
  listShares,
  MEMON_RELEASE,
  ProjectRefSchema,
  revokeShare,
  validateShare,
} from '@memon/core'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilesystemDocumentService } from '../../../../packages/backend/src/document-service.js'
import { BackendEventStream } from '../../../../packages/backend/src/event-stream.js'
import { FilesystemGitService } from '../../../../packages/backend/src/git-service.js'
import { FilesystemMutationService } from '../../../../packages/backend/src/mutation-service.js'
import { FilesystemProjectService } from '../../../../packages/backend/src/project-service.js'
import { createBackendServer } from '../../../../packages/backend/src/server.js'
import { createBackendSlurmService } from '../../../../packages/backend/src/slurm-service.js'
import { FilesystemStreamService } from '../../../../packages/backend/src/stream-service.js'
import type {
  BackendTerminalAttachInput,
  BackendTerminalService,
  BackendTerminalStartInput,
} from '../../../../packages/backend/src/terminal-service.js'
import {
  fetchCodeReview,
  fetchDigest,
  fetchExperiment,
  fetchExperimentDoc,
  fetchProjects,
  fetchReport,
  projectQueryKey,
  projectWebPath,
  putReport,
} from '../api'
import { createMemonServer } from '../server-core'
import { CentralEventFanIn } from './backend-events'
import { aggregateCentralProjects } from './central-projects'
import { CentralHostRegistry } from './host-registry'
import { createCentralHttpBridge } from './http-bridge'
import { createCentralTerminalRelay } from './terminal-relay'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const SESSION = 'memon-codex-shared--project--root'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  git: true,
  shares: true,
  tmux: true,
  terminal: true,
  slurm: false,
  herdr: false,
} satisfies BackendCapabilities

const servers = new Set<Server>()
const temporaryDirectories = new Set<string>()

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
  servers.clear()
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  )
  temporaryDirectories.clear()
  vi.unstubAllGlobals()
})

async function listen(server: Server): Promise<number> {
  servers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return (server.address() as AddressInfo).port
}

class FakeTerminalService implements BackendTerminalService {
  active = false
  tmuxAlive = true
  herdrStarts = 0

  constructor(
    readonly host: string,
    readonly ttydPort: number,
  ) {}

  async check() {
    return { available: true, version: '1.7.7', source: 'path' }
  }

  async install() {
    return { ok: true, version: '1.7.7', durationMs: 1 }
  }

  async start(_input: BackendTerminalStartInput) {
    this.active = true
    return this.session()
  }

  async startHerdr() {
    this.herdrStarts += 1
    this.active = true
    return {
      ...this.session(),
      backend: 'herdr' as const,
      sessionName: 'memon-herdr',
      url: `/api/terminal/proxy/${this.host}/memon-herdr/`,
    }
  }

  async attach(_input: BackendTerminalAttachInput) {
    this.active = true
    return this.session()
  }

  list() {
    return { sessions: this.active ? [this.session()] : [] }
  }

  async stop(_input: BackendTerminalAttachInput) {
    const stopped = this.active
    this.active = false
    return { stopped }
  }

  async listTmux() {
    return { sessions: this.tmuxAlive ? [this.tmuxRow()] : [] }
  }

  async getTmux() {
    return { row: this.tmuxRow() }
  }

  async createTmux(input: { name: string }) {
    return {
      ok: true,
      host: this.host,
      sessionName: `memon-manual-${input.name}`,
      alreadyExisted: false,
    }
  }

  async renameTmux(_sessionName: string, input: { newName: string }) {
    return { ok: true, host: this.host, sessionName: input.newName }
  }

  async killTmux() {
    this.tmuxAlive = false
    return { ok: true, host: this.host, sessionName: SESSION }
  }

  target(sessionName: string): string | null {
    return (this.active && sessionName === SESSION) ||
      (this.herdrStarts > 0 && sessionName === 'memon-herdr')
      ? `http://127.0.0.1:${this.ttydPort}`
      : null
  }

  private session() {
    return {
      host: this.host,
      backend: 'tmux' as const,
      sessionName: SESSION,
      url: `/api/terminal/proxy/${this.host}/${SESSION}/`,
      startedAt: '2026-08-26T19:00:00.000Z',
      lastActiveAt: '2026-08-26T19:00:01.000Z',
      agent: 'codex' as const,
      project: 'shared',
      scope: 'project' as const,
      slug: 'root',
      warnings: [],
    }
  }

  private tmuxRow() {
    return {
      host: this.host,
      sessionName: SESSION,
      parsed: {
        raw: SESSION,
        agent: 'codex' as const,
        project: 'shared',
        scope: 'project' as const,
        slug: 'root',
        legacy: false,
      },
      liveEntry: null,
      tmuxCreatedAt: '2026-08-26T18:00:00.000Z',
      tmuxLastActivity: '2026-08-26T19:00:00.000Z',
      matchable: true,
      staleReason: null,
      pane: { title: 'idle', currentCommand: 'bash', currentPath: null },
      state: 'idle' as const,
      lastStateChangeAt: null,
    }
  }
}

function hostConfig(id: string, port: number, token: string): CentralConfig['hosts'][number] {
  return {
    id,
    tokens: { current: token },
    transport: {
      kind: 'url',
      baseUrl: `http://127.0.0.1:${port}`,
      allowInsecureHttp: true,
    },
  }
}

function markOnline(
  registry: CentralHostRegistry,
  host: string,
  capabilities: BackendCapabilities = CAPABILITIES,
): void {
  registry.acceptMetadata(host, {
    host,
    release: MEMON_RELEASE,
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef',
    instanceEpoch: randomUUID(),
    ready: true,
    capabilities,
  })
}

function basic(): string {
  return `Basic ${Buffer.from('owner:password', 'utf8').toString('base64')}`
}

async function request(
  port: number,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: Buffer }> {
  const body = options.body === undefined ? null : JSON.stringify(options.body)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: {
          authorization: basic(),
          host: `127.0.0.1:${port}`,
          origin: `http://127.0.0.1:${port}`,
          ...(body === null
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
              }),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        )
      },
    )
    req.once('error', reject)
    req.end(body)
  })
}

describe('central terminal lifecycle to public relay', () => {
  it('keeps equal sessions isolated and never retargets after stop or Host failure', async () => {
    const ttydA = await listen(
      createHttpServer((_request, response) => response.end(Buffer.from('asset-a'))),
    )
    const ttydB = await listen(
      createHttpServer((_request, response) => response.end(Buffer.from('asset-b'))),
    )
    const serviceA = new FakeTerminalService('host-a', ttydA)
    const serviceB = new FakeTerminalService('host-b', ttydB)
    const backendA = await listen(
      createBackendServer({
        hostId: 'host-a',
        serviceTokens: { current: TOKEN_A },
        capabilities: CAPABILITIES,
        revision: '0123456789abcdef',
        terminalService: serviceA,
      }),
    )
    const backendB = await listen(
      createBackendServer({
        hostId: 'host-b',
        serviceTokens: { current: TOKEN_B },
        capabilities: { ...CAPABILITIES, herdr: true },
        revision: '0123456789abcdef',
        terminalService: serviceB,
      }),
    )
    const centralConfig: CentralConfig = {
      bindAddr: '127.0.0.1',
      bindPort: 0,
      hosts: [hostConfig('host-a', backendA, TOKEN_A), hostConfig('host-b', backendB, TOKEN_B)],
    }
    const registry = new CentralHostRegistry(centralConfig)
    markOnline(registry, 'host-a')
    markOnline(registry, 'host-b', { ...CAPABILITIES, herdr: true })
    const runtimeAuth = { username: 'owner', password: 'password' }
    const rateLimit = { consume: () => ({ ok: true as const }), refund: vi.fn() }
    const central = await listen(
      createMemonServer({
        centralGateway: createCentralHttpBridge({ registry, runtimeAuth, rateLimit }),
        centralTerminalRelay: createCentralTerminalRelay({ registry, runtimeAuth, rateLimit }),
        handle: (_request, response) => {
          response.writeHead(500)
          response.end()
        },
      }),
    )
    const startBody = { project: 'shared', scope: 'project', slug: 'root', agent: 'codex' }

    const startA = await request(central, '/api/terminal/start?host=host-a&project=shared', {
      method: 'POST',
      body: startBody,
    })
    const startB = await request(central, '/api/terminal/start?host=host-b&project=shared', {
      method: 'POST',
      body: startBody,
    })
    expect(startA.status).toBe(200)
    expect(startB.status).toBe(200)
    const sessionA = JSON.parse(startA.body.toString()) as { sessionName: string; url: string }
    const sessionB = JSON.parse(startB.body.toString()) as { sessionName: string; url: string }
    expect(sessionA.sessionName).toBe(sessionB.sessionName)
    expect(sessionA.url).toContain('/host-a/')
    expect(sessionB.url).toContain('/host-b/')
    expect((await request(central, `${sessionA.url}asset`)).body.toString()).toBe('asset-a')
    expect((await request(central, `${sessionB.url}asset`)).body.toString()).toBe('asset-b')

    const tmuxA = await request(central, '/api/tmux-sessions?host=host-a')
    const tmuxB = await request(central, '/api/tmux-sessions?host=host-b')
    expect(JSON.parse(tmuxA.body.toString()).sessions[0].host).toBe('host-a')
    expect(JSON.parse(tmuxB.body.toString()).sessions[0].host).toBe('host-b')
    await request(central, `/api/tmux-sessions/${SESSION}?host=host-a`, { method: 'DELETE' })
    expect(serviceA.tmuxAlive).toBe(false)
    expect(serviceB.tmuxAlive).toBe(true)

    const herdrA = await request(central, '/api/terminal/herdr?host=host-a&project=shared', {
      method: 'POST',
      body: { project: 'shared', scope: 'project', slug: 'root' },
    })
    const herdrB = await request(central, '/api/terminal/herdr?host=host-b&project=shared', {
      method: 'POST',
      body: { project: 'shared', scope: 'project', slug: 'root' },
    })
    expect(herdrA.status).toBe(409)
    expect(herdrB.status).toBe(200)
    const herdrSession = JSON.parse(herdrB.body.toString())
    expect(herdrSession).toMatchObject({
      host: 'host-b',
      backend: 'herdr',
      sessionName: 'memon-herdr',
    })
    expect(serviceA.herdrStarts).toBe(0)
    expect(serviceB.herdrStarts).toBe(1)
    expect((await request(central, `${herdrSession.url}asset`)).body.toString()).toBe('asset-b')

    const stoppedA = await request(central, '/api/terminal/stop?host=host-a', {
      method: 'POST',
      body: { sessionName: SESSION },
    })
    expect(stoppedA.status).toBe(200)
    expect((await request(central, `${sessionA.url}asset`)).status).toBe(502)
    expect((await request(central, `${sessionB.url}asset`)).body.toString()).toBe('asset-b')

    registry.markFailure('host-b', 'offline', 'tunnel lost')
    expect((await request(central, `${sessionB.url}asset`)).status).toBe(502)
    expect(serviceA.active).toBe(false)
    expect(serviceB.active).toBe(true)
  })

  it('routes a duplicate-name synthetic fleet through real Backend data services', async () => {
    const nativeFetch = globalThis.fetch.bind(globalThis)
    const fixture = resolve(process.cwd(), '../../mock/project-a')
    const directory = await fs.mkdtemp(join(tmpdir(), 'memon-synthetic-fleet-'))
    temporaryDirectories.add(directory)
    const rootA = join(directory, 'host-a')
    const rootB = join(directory, 'host-b')
    await Promise.all([
      fs.cp(fixture, rootA, { recursive: true }),
      fs.cp(fixture, rootB, { recursive: true }),
    ])
    await Promise.all([
      replaceInFile(
        join(rootB, 'logs/foo-260501-100000/README.md'),
        'name: foo',
        'name: host-b-foo',
      ),
      replaceInFile(
        join(rootB, 'docs/experiments/E0001-vpred-convergence/README.md'),
        'title: v-prediction vs ε-prediction convergence study',
        'title: Host B convergence study',
      ),
      fs.writeFile(join(rootB, 'docs/reports/R0001-zero-snr-brightness.md'), '# Host B report\n'),
      fs.writeFile(join(rootB, 'docs/digests/D0001-2026-05-01.md'), '# Host B digest\n'),
      replaceInFile(
        join(rootB, 'docs/code-review/2026-05-24-fsdp-comm-overlap.md'),
        'title: FSDP all-gather / compute overlap',
        'title: Host B FSDP review',
      ),
    ])

    const ttydA = await listen(
      createHttpServer((_request, response) => response.end(Buffer.from('fleet-asset-a'))),
    )
    const ttydB = await listen(
      createHttpServer((_request, response) => response.end(Buffer.from('fleet-asset-b'))),
    )
    const terminalA = new FakeTerminalService('host-a', ttydA)
    const terminalB = new FakeTerminalService('host-b', ttydB)
    const epochA = randomUUID()
    const epochB = randomUUID()
    const eventStreamA = new BackendEventStream({ instanceEpoch: epochA })
    const eventStreamB = new BackendEventStream({ instanceEpoch: epochB })
    const projectA = { name: 'shared', root: rootA, include: [], exclude: [] }
    const projectB = { name: 'shared', root: rootB, include: [], exclude: [] }
    const capabilitiesA = CAPABILITIES
    const capabilitiesB = { ...CAPABILITIES, slurm: true, herdr: true }

    const backendA = await listen(
      createBackendServer(
        fleetBackendOptions({
          host: 'host-a',
          token: TOKEN_A,
          project: projectA,
          capabilities: capabilitiesA,
          terminalService: terminalA,
          eventStream: eventStreamA,
          instanceEpoch: epochA,
          slurmService: null,
        }),
      ),
    )
    const backendB = await listen(
      createBackendServer(
        fleetBackendOptions({
          host: 'host-b',
          token: TOKEN_B,
          project: projectB,
          capabilities: capabilitiesB,
          terminalService: terminalB,
          eventStream: eventStreamB,
          instanceEpoch: epochB,
          slurmService: createBackendSlurmService({
            totalNodes: 2,
            provider: async () => [
              {
                jobId: 'same-job',
                partition: 'gpu',
                name: 'shared-job',
                state: 'R',
                time: '00:01',
                numNodes: 1,
                nodeList: 'host-b-node',
              },
            ],
          }),
        }),
      ),
    )

    const centralConfig: CentralConfig = {
      bindAddr: '127.0.0.1',
      bindPort: 0,
      hosts: [hostConfig('host-a', backendA, TOKEN_A), hostConfig('host-b', backendB, TOKEN_B)],
    }
    const registry = new CentralHostRegistry(centralConfig)
    markOnline(registry, 'host-a', capabilitiesA)
    markOnline(registry, 'host-b', capabilitiesB)
    const runtimeAuth = {
      username: 'owner',
      password: 'password',
      sessionSecret: 'synthetic-fleet-session-secret-aaaaaaaa',
    }
    const rateLimit = { consume: () => ({ ok: true as const }), refund: vi.fn() }
    const central = await listen(
      createMemonServer({
        centralGateway: createCentralHttpBridge({
          registry,
          runtimeAuth,
          rateLimit,
          fetchImpl: nativeFetch,
        }),
        centralTerminalRelay: createCentralTerminalRelay({ registry, runtimeAuth, rateLimit }),
        handle: async (incoming, response) => {
          if (new URL(incoming.url ?? '/', 'http://central.invalid').pathname !== '/api/projects') {
            response.writeHead(404)
            response.end()
            return
          }
          const payload = await aggregateCentralProjects({ registry, fetchImpl: nativeFetch })
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify(payload))
        },
      }),
    )
    const centralOrigin = `http://127.0.0.1:${central}`
    const centralEvents: Array<{ host?: string; project?: string; topic?: string }> = []
    const fanIn = new CentralEventFanIn({
      sink: (event) => {
        centralEvents.push(event)
      },
    })
    fanIn.addHost(
      {
        hostId: 'host-a',
        transport: 'url',
        baseUrl: `http://127.0.0.1:${backendA}`,
        serviceToken: TOKEN_A,
      },
      { fetchImpl: nativeFetch },
    )
    fanIn.addHost(
      {
        hostId: 'host-b',
        transport: 'url',
        baseUrl: `http://127.0.0.1:${backendB}`,
        serviceToken: TOKEN_B,
      },
      { fetchImpl: nativeFetch },
    )
    fanIn.start()

    const requestedUrls: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const raw = input instanceof Request ? input.url : String(input)
      const url = new URL(raw, centralOrigin)
      requestedUrls.push(`${url.pathname}${url.search}`)
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
      headers.set('authorization', basic())
      return nativeFetch(url, { ...init, headers })
    })

    try {
      await vi.waitFor(() => {
        expect(eventStreamA.subscriberCount).toBe(1)
        expect(eventStreamB.subscriberCount).toBe(1)
      })
      const targetA = ProjectRefSchema.parse({ host: 'host-a', project: 'shared' })
      const targetB = ProjectRefSchema.parse({ host: 'host-b', project: 'shared' })

      expect((await fetchProjects()).projects).toEqual(
        expect.arrayContaining([
          expect.objectContaining(targetA),
          expect.objectContaining(targetB),
        ]),
      )
      const runA = await fetchExperiment(targetA, 'foo-260501-100000')
      const runB = await fetchExperiment(targetB, 'foo-260501-100000')
      expect(runA.frontMatter.name).toBe('foo')
      expect(runB.frontMatter.name).toBe('host-b-foo')
      expect(
        (await fetchExperimentDoc(targetA, 'E0001-vpred-convergence')).frontMatter.title,
      ).not.toContain('Host B')
      expect((await fetchExperimentDoc(targetB, 'E0001-vpred-convergence')).frontMatter.title).toBe(
        'Host B convergence study',
      )
      const reportA = await fetchReport(targetA, 'R0001')
      const reportB = await fetchReport(targetB, 'R0001')
      expect(reportA.content).not.toContain('Host B report')
      expect(reportB.content).toContain('Host B report')
      expect((await fetchDigest(targetB, 'D0001')).content).toContain('Host B digest')
      expect(
        (await fetchCodeReview(targetB, 'code-review/2026-05-24-fsdp-comm-overlap')).frontmatter
          .title,
      ).toBe('Host B FSDP review')
      expect(projectQueryKey(targetA)).toEqual(['host-a', 'shared'])
      expect(projectQueryKey(targetB)).toEqual(['host-b', 'shared'])
      const queryClient = new QueryClient()
      const runKeyA = ['run', ...projectQueryKey(targetA), 'foo-260501-100000'] as const
      const runKeyB = ['run', ...projectQueryKey(targetB), 'foo-260501-100000'] as const
      queryClient.setQueryData(runKeyA, runA)
      queryClient.setQueryData(runKeyB, runB)
      expect(queryClient.getQueryData<typeof runA>(runKeyA)?.frontMatter.name).toBe('foo')
      expect(queryClient.getQueryData<typeof runB>(runKeyB)?.frontMatter.name).toBe('host-b-foo')
      expect(projectWebPath(targetA, '/reports/R0001')).toBe('/h/host-a/p/shared/reports/R0001')
      expect(requestedUrls).toEqual(
        expect.arrayContaining([
          expect.stringContaining('host=host-a&project=shared'),
          expect.stringContaining('host=host-b&project=shared'),
        ]),
      )

      await putReport(targetA, 'R0001', {
        content: '# Host A updated report\n',
        expectedMtime: reportA.mtime,
        expectedHash: reportA.hash,
      })
      await vi.waitFor(() =>
        expect(centralEvents).toContainEqual(
          expect.objectContaining({
            host: 'host-a',
            project: 'shared',
            topic: 'reports-change',
          }),
        ),
      )
      const reportEvents = centralEvents.filter((event) => event.topic === 'reports-change').length
      await expect(
        putReport(targetA, 'R0001', {
          content: '# stale\n',
          expectedMtime: reportA.mtime,
          expectedHash: reportA.hash,
        }),
      ).rejects.toMatchObject({ status: 409 })
      expect(centralEvents.filter((event) => event.topic === 'reports-change')).toHaveLength(
        reportEvents,
      )
      expect((await fetchReport(targetB, 'R0001')).content).toContain('Host B report')

      const shareA = await request(
        central,
        '/api/projects/shared/shares?host=host-a&project=shared',
        { method: 'POST', body: { label: 'same-share' } },
      )
      const shareB = await request(
        central,
        '/api/projects/shared/shares?host=host-b&project=shared',
        { method: 'POST', body: { label: 'same-share' } },
      )
      expect(shareA.status).toBe(201)
      expect(shareB.status).toBe(201)
      const shareIdA = (JSON.parse(shareA.body.toString()) as { share: { id: string } }).share.id
      const shareIdB = (JSON.parse(shareB.body.toString()) as { share: { id: string } }).share.id
      expect(shareIdA).not.toBe(shareIdB)
      await request(central, `/api/projects/shared/shares/${shareIdA}?host=host-a&project=shared`, {
        method: 'DELETE',
      })
      expect(await listShares(rootA)).toHaveLength(0)
      expect(await listShares(rootB)).toHaveLength(1)

      const tmuxA = JSON.parse(
        (await request(central, '/api/tmux-sessions?host=host-a')).body.toString(),
      )
      const tmuxB = JSON.parse(
        (await request(central, '/api/tmux-sessions?host=host-b')).body.toString(),
      )
      expect(tmuxA.sessions[0].sessionName).toBe(SESSION)
      expect(tmuxB.sessions[0].sessionName).toBe(SESSION)
      expect(tmuxA.sessions[0].host).toBe('host-a')
      expect(tmuxB.sessions[0].host).toBe('host-b')

      const terminalBody = { project: 'shared', scope: 'project', slug: 'root', agent: 'codex' }
      const terminalSessionA = JSON.parse(
        (
          await request(central, '/api/terminal/start?host=host-a&project=shared', {
            method: 'POST',
            body: terminalBody,
          })
        ).body.toString(),
      )
      const terminalSessionB = JSON.parse(
        (
          await request(central, '/api/terminal/start?host=host-b&project=shared', {
            method: 'POST',
            body: terminalBody,
          })
        ).body.toString(),
      )
      expect(terminalSessionA.sessionName).toBe(terminalSessionB.sessionName)
      expect((await request(central, `${terminalSessionA.url}asset`)).body.toString()).toBe(
        'fleet-asset-a',
      )
      expect((await request(central, `${terminalSessionB.url}asset`)).body.toString()).toBe(
        'fleet-asset-b',
      )

      expect((await request(central, '/api/slurm/status?host=host-a&project=shared')).status).toBe(
        409,
      )
      const slurmB = await request(central, '/api/slurm/status?host=host-b&project=shared')
      expect(slurmB.status).toBe(200)
      expect(JSON.parse(slurmB.body.toString()).jobs[0].nodeList).toBe('host-b-node')
      const herdrBody = { project: 'shared', scope: 'project', slug: 'root' }
      expect(
        (
          await request(central, '/api/terminal/herdr?host=host-a&project=shared', {
            method: 'POST',
            body: herdrBody,
          })
        ).status,
      ).toBe(409)
      expect(
        (
          await request(central, '/api/terminal/herdr?host=host-b&project=shared', {
            method: 'POST',
            body: herdrBody,
          })
        ).status,
      ).toBe(200)
      expect(terminalA.herdrStarts).toBe(0)
      expect(terminalB.herdrStarts).toBe(1)
    } finally {
      vi.unstubAllGlobals()
      await fanIn.stop()
    }
  }, 60_000)
})

async function replaceInFile(path: string, before: string, after: string): Promise<void> {
  const content = await fs.readFile(path, 'utf8')
  if (!content.includes(before)) throw new Error(`fixture text not found: ${before}`)
  await fs.writeFile(path, content.replace(before, after))
}

function fleetBackendOptions(input: {
  host: string
  token: string
  project: { name: string; root: string; include: string[]; exclude: string[] }
  capabilities: BackendCapabilities
  terminalService: BackendTerminalService
  eventStream: BackendEventStream
  instanceEpoch: string
  slurmService: ReturnType<typeof createBackendSlurmService>
}) {
  const projects = [input.project]
  return {
    hostId: input.host,
    serviceTokens: { current: input.token },
    capabilities: input.capabilities,
    revision: '0123456789abcdef',
    instanceEpoch: input.instanceEpoch,
    eventStream: input.eventStream,
    terminalService: input.terminalService,
    slurmService: input.slurmService,
    projectDiscovery: () => [{ name: input.project.name }],
    projectService: new FilesystemProjectService(projects),
    documentService: new FilesystemDocumentService(projects),
    gitService: new FilesystemGitService(projects),
    streamService: new FilesystemStreamService(projects),
    mutationService: new FilesystemMutationService(projects),
    shareValidator: async (projectName: string, token: string) =>
      projectName === input.project.name &&
      (await validateShare(input.project.root, token).catch(() => null)) !== null,
    shareProviders: {
      list: (_projectName: string, includeTokens: boolean) =>
        listShares(input.project.root, { includeTokens }),
      add: (_projectName: string, options: { label?: string; expires?: string }) =>
        addShare(input.project.root, options),
      revoke: (_projectName: string, id: string) => revokeShare(input.project.root, id),
    },
  }
}
