import { promises as fs } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendLogFilesResponseSchema,
  BackendLogLinesResponseSchema,
  type ProjectConfig,
} from '@memon/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { createBackendServer } from './server.js'
import {
  type BackendByteResource,
  type BackendStreamService,
  FilesystemStreamService,
} from './stream-service.js'

const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const LARGE_BYTES = 32 * 1024 * 1024
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

let workspace = ''
let rootA = ''
let rootB = ''
let origin = ''
let server: ReturnType<typeof createBackendServer>
let service: FilesystemStreamService

function actorHeader(actor: ActorContext): string {
  return Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
}

const owner = ActorContextSchema.parse({ role: 'owner' })

function authenticatedHeaders(actor: ActorContext = owner): Record<string, string> {
  return {
    authorization: `Bearer ${SERVICE_TOKEN}`,
    [BACKEND_ACTOR_CONTEXT_HEADER]: actorHeader(actor),
  }
}

async function writeLargeFile(path: string): Promise<void> {
  const handle = await fs.open(path, 'w')
  const chunk = Buffer.alloc(64 * 1024, 0x61)
  try {
    for (let written = 0; written < LARGE_BYTES; written += chunk.length) {
      await handle.write(chunk)
    }
  } finally {
    await handle.close()
  }
}

beforeAll(async () => {
  workspace = await fs.mkdtemp(join(tmpdir(), 'memon-backend-stream-routes-'))
  rootA = join(workspace, 'project-a')
  rootB = join(workspace, 'project-b')
  for (const [root, marker] of [
    [rootA, 'a'],
    [rootB, 'b'],
  ] as const) {
    await Promise.all([
      fs.mkdir(join(root, 'logs', 'run-one', 'logs'), { recursive: true }),
      fs.mkdir(join(root, 'docs', 'reports', 'R0001-bundle', 'data'), { recursive: true }),
    ])
    await Promise.all([
      fs.writeFile(join(root, 'logs', 'run-one', 'README.md'), '# Run\n'),
      fs.writeFile(join(root, 'logs', 'run-one', 'train.log'), `${marker}1\n${marker}2\n`),
      fs.writeFile(join(root, 'docs', 'reports', 'R0001-bundle', 'README.md'), '# Bundle\n'),
      fs.writeFile(
        join(root, 'docs', 'reports', 'R0001-bundle', 'data', 'range.txt'),
        `0123456789${marker}`,
      ),
    ])
  }
  await writeLargeFile(join(rootA, 'docs', 'reports', 'R0001-bundle', 'data', 'large.bin'))
  await fs.writeFile(join(workspace, 'outside.txt'), 'private')
  await fs.symlink(
    join(workspace, 'outside.txt'),
    join(rootA, 'docs', 'reports', 'R0001-bundle', 'leak.txt'),
  )
  await fs.symlink(join(workspace, 'outside.txt'), join(rootA, 'logs', 'run-one', 'leak.log'))
  const projects = [
    { name: 'project-a', root: rootA, include: [], exclude: [] },
    { name: 'project-b', root: rootB, include: [], exclude: [] },
  ] satisfies ProjectConfig[]
  service = new FilesystemStreamService(projects, { logStreamPollMs: 20 })
  server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: SERVICE_TOKEN },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    streamService: service,
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
  await new Promise<void>((resolveClose) => {
    server.close(() => resolveClose())
    server.closeAllConnections()
  })
  await fs.rm(workspace, { recursive: true, force: true })
})

async function streamRequest(
  requestOrigin: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  bytes: number
  maxChunk: number
  body: Buffer
}> {
  const target = new URL(requestOrigin)
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        headers: { ...authenticatedHeaders(), ...headers },
      },
      (response) => {
        let bytes = 0
        let maxChunk = 0
        const smallBody: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          maxChunk = Math.max(maxChunk, chunk.length)
          if (bytes <= 1024) smallBody.push(Buffer.from(chunk))
        })
        response.on('end', () => {
          resolveRequest({
            status: response.statusCode ?? 0,
            headers: response.headers,
            bytes,
            maxChunk,
            body: Buffer.concat(smallBody),
          })
        })
      },
    )
    request.on('error', rejectRequest)
    request.end()
  })
}

describe('Backend log and Report-asset streaming routes', () => {
  it('serves path-free log discovery/line windows with exact actor scope', async () => {
    const filesResponse = await fetch(
      `${origin}/api/backend/v1/log-files?project=project-a&resource=logs%2Frun-one%2FREADME.md`,
      { headers: authenticatedHeaders() },
    )
    expect(filesResponse.status).toBe(200)
    const files = BackendLogFilesResponseSchema.parse(await filesResponse.json())
    expect(files.files.map((file) => file.resource)).toEqual(['logs/run-one/train.log'])
    expect(JSON.stringify(files)).not.toContain(rootA)

    const lines = BackendLogLinesResponseSchema.parse(
      await (
        await fetch(
          `${origin}/api/backend/v1/log?project=project-a&resource=logs%2Frun-one%2Ftrain.log&count=1`,
          { headers: authenticatedHeaders() },
        )
      ).json(),
    )
    expect(lines.lines).toEqual([{ lineNumber: 2, text: 'a2' }])

    const wrongHost = ActorContextSchema.parse({
      role: 'viewer',
      scopes: [{ host: 'host-b', project: 'project-a' }],
    })
    expect(
      (
        await fetch(
          `${origin}/api/backend/v1/log?project=project-a&resource=logs%2Frun-one%2Ftrain.log`,
          { headers: authenticatedHeaders(wrongHost) },
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await fetch(
          `${origin}/api/backend/v1/log?project=project-a&resource=logs%2Frun-one%2Fleak.log`,
          { headers: authenticatedHeaders() },
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await fetch(`${origin}/api/backend/v1/log?project=project-a&resource=%2Fetc%2Fpasswd`, {
          headers: authenticatedHeaders(),
        })
      ).status,
    ).toBe(404)
  })

  it('streams 32 MiB without whole-body buffering and implements Range/cache/HEAD metadata', async () => {
    const largePath = '/api/backend/v1/report-assets/project-a/R0001/data/large.bin'
    const large = await streamRequest(origin, largePath)
    expect(large.status).toBe(200)
    expect(large.bytes).toBe(LARGE_BYTES)
    expect(large.maxChunk).toBeLessThanOrEqual(128 * 1024)
    expect(large.headers['content-length']).toBe(String(LARGE_BYTES))
    expect(large.headers['accept-ranges']).toBe('bytes')

    const rangePath = '/api/backend/v1/report-assets/project-a/R0001/data/range.txt'
    const partial = await streamRequest(origin, rangePath, { range: 'bytes=2-5' })
    expect(partial.status).toBe(206)
    expect(partial.body.toString()).toBe('2345')
    expect(partial.headers['content-range']).toBe('bytes 2-5/11')
    const etag = String(partial.headers.etag)

    const head = await fetch(`${origin}${rangePath}`, {
      method: 'HEAD',
      headers: authenticatedHeaders(),
    })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect(head.headers.get('x-memon-resource-version')).toMatch(/^[a-f0-9]{40}$/)
    expect(
      (
        await fetch(`${origin}${rangePath}`, {
          headers: { ...authenticatedHeaders(), 'if-none-match': etag },
        })
      ).status,
    ).toBe(304)
    const unsatisfied = await fetch(`${origin}${rangePath}`, {
      headers: { ...authenticatedHeaders(), range: 'bytes=999-1000' },
    })
    expect(unsatisfied.status).toBe(416)
    expect(unsatisfied.headers.get('content-range')).toBe('bytes */11')
  }, 30_000)

  it('keeps equal Report IDs Project-scoped and rejects asset symlink/traversal escape', async () => {
    const a = await streamRequest(
      origin,
      '/api/backend/v1/report-assets/project-a/R0001/data/range.txt',
    )
    const b = await streamRequest(
      origin,
      '/api/backend/v1/report-assets/project-b/R0001/data/range.txt',
    )
    expect(a.body.toString()).toBe('0123456789a')
    expect(b.body.toString()).toBe('0123456789b')
    expect(
      (
        await fetch(`${origin}/api/backend/v1/report-assets/project-a/R0001/leak.txt`, {
          headers: authenticatedHeaders(),
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await fetch(
          `${origin}/api/backend/v1/report-assets/project-a/R0001/%252e%252e%2FREADME.md`,
          { headers: authenticatedHeaders() },
        )
      ).status,
    ).toBe(404)
  })

  it('propagates SSE append events and browser abort', async () => {
    const abort = new AbortController()
    const response = await fetch(
      `${origin}/api/backend/v1/log/stream?project=project-a&resource=logs%2Frun-one%2Ftrain.log`,
      { headers: authenticatedHeaders(), signal: abort.signal },
    )
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = decoder.decode((await reader.read()).value, { stream: true })
    expect(text).toContain('event: ready')
    await fs.appendFile(join(rootA, 'logs', 'run-one', 'train.log'), 'a3\n')
    for (let attempt = 0; attempt < 20 && !text.includes('event: append'); attempt += 1) {
      const next = await reader.read()
      if (next.done) break
      text += decoder.decode(next.value, { stream: true })
    }
    expect(text).toContain('event: append')
    expect(text).toContain('"text":"a3"')
    abort.abort()
    await expect(reader.read()).rejects.toThrow()
  })

  it('bounds control/header work with a configurable deadline', async () => {
    const listLogFiles = vi.fn(() => new Promise<never>(() => {}))
    const deadlineServer = createBackendServer({
      hostId: 'host-a',
      serviceTokens: { current: SERVICE_TOKEN },
      capabilities: CAPABILITIES,
      revision: '0123456789abcdef',
      streamControlDeadlineMs: 20,
      streamService: { listLogFiles } as unknown as BackendStreamService,
    })
    await new Promise<void>((resolveListen) => deadlineServer.listen(0, '127.0.0.1', resolveListen))
    const address = deadlineServer.address() as AddressInfo
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/backend/v1/log-files?project=project-a&resource=logs%2Frun-one%2FREADME.md`,
      { headers: authenticatedHeaders() },
    )
    expect(response.status).toBe(504)
    expect(listLogFiles).toHaveBeenCalledOnce()
    await new Promise<void>((resolveClose) => {
      deadlineServer.close(() => resolveClose())
      deadlineServer.closeAllConnections()
    })
  })

  it('destroys a bounded upstream stream when a slow downstream disconnects', async () => {
    let maxReadableLength = 0
    let closed = false
    const source = new Readable({
      highWaterMark: 64 * 1024,
      read() {
        maxReadableLength = Math.max(maxReadableLength, this.readableLength)
        this.push(Buffer.alloc(64 * 1024, 0x61))
      },
      destroy(error, callback) {
        closed = true
        callback(error)
      },
    })
    const metadata: BackendByteResource = {
      project: 'project-a',
      resource: 'docs/reports/R0001-bundle/infinite.bin',
      absolutePath: '/not-used',
      contentType: 'application/octet-stream',
      size: Number.MAX_SAFE_INTEGER,
      mtimeMs: 1,
      etag: 'W/"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
      version: 'a'.repeat(40),
    }
    const fakeService = {
      resolveReportAsset: vi.fn(async () => metadata),
      openByteStream: vi.fn(() => source),
    } as unknown as BackendStreamService
    const slowServer = createBackendServer({
      hostId: 'host-a',
      serviceTokens: { current: SERVICE_TOKEN },
      capabilities: CAPABILITIES,
      revision: '0123456789abcdef',
      streamService: fakeService,
    })
    await new Promise<void>((resolveListen) => slowServer.listen(0, '127.0.0.1', resolveListen))
    const address = slowServer.address() as AddressInfo
    await new Promise<void>((resolveAbort, rejectAbort) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/api/backend/v1/report-assets/project-a/R0001/infinite.bin',
          headers: authenticatedHeaders(),
        },
        (response) => {
          response.once('data', () => {
            response.pause()
            setTimeout(() => {
              response.destroy()
              resolveAbort()
            }, 50)
          })
        },
      )
      request.on('error', rejectAbort)
      request.end()
    })
    await vi.waitFor(() => expect(closed).toBe(true))
    expect(maxReadableLength).toBeLessThanOrEqual(128 * 1024)
    await new Promise<void>((resolveClose) => {
      slowServer.close(() => resolveClose())
      slowServer.closeAllConnections()
    })
  })
})
