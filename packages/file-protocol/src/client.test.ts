import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  createTempProject,
  createTLSFixture,
  makeTempDir,
  removeTempDirs,
  type TempProject,
} from '@memon/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FileAgentClient } from './client.js'
import { contentVersion, FileAccessError } from './index.js'

let child: ChildProcess
let project: TempProject
let client: FileAgentClient
let logs = ''
let endpoint: string
let configPath: string
let config: Record<string, unknown>
let credential: { ca: Buffer; certificate: Buffer; key: Buffer }

beforeAll(async () => {
  project = await createTempProject({ files: { 'docs/a.txt': 'inside', 'run.log': '0123456789' } })
  const certificates = await createTLSFixture()
  credential = {
    ca: await readFile(certificates.ca),
    certificate: await readFile(certificates.client),
    key: await readFile(certificates.clientKey),
  }
  const state = await makeTempDir('memon-agent-client-')
  const port = await new Promise<number>((resolve, reject) => {
    const listener = createServer()
    listener.on('error', reject)
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address()
      if (!address || typeof address === 'string') throw new Error('missing port')
      listener.close(() => resolve(address.port))
    })
  })
  endpoint = `https://127.0.0.1:${port}`
  config = {
    listen: `127.0.0.1:${port}`,
    certificate: certificates.server,
    key: certificates.serverKey,
    clientCA: certificates.ca,
    replayDirectory: join(state, 'replay'),
    projects: {
      'project-a': {
        root: project.root,
        sourceIdentity: 'source-a',
        acknowledgedWriterLockVersion: 1,
      },
    },
    grants: { [certificates.fingerprint]: { 'project-a': 'read-write' } },
  }
  configPath = join(state, 'config.json')
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
  const binary = fileURLToPath(new URL('../../file-agent/dist/memon-file-agent', import.meta.url))
  child = spawn(binary, ['--config', configPath], { stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr?.on('data', (bytes: Buffer) => {
    logs = (logs + bytes.toString()).slice(-4096)
  })
  child.on('error', (error) => {
    logs += error.message
  })
  const { stdout } = await promisify(execFile)(binary, ['--config', configPath, '--describe'])
  const sourceIdentity = (JSON.parse(stdout) as { projects: Record<string, string> }).projects[
    'project-a'
  ]!
  client = new FileAgentClient({
    endpoint,
    ...credential,
    expectedSourceIdentity: sourceIdentity,
    concurrency: 2,
  })
  await vi.waitFor(
    async () => {
      const result = await client.stat({ project: 'project-a', path: 'docs/a.txt' })
      expect(result.outcome, logs).toBe('present')
    },
    { timeout: 10_000 },
  )
}, 30_000)

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 5000)
      child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
  await removeTempDirs()
})

describe('native-agent client integration', () => {
  it('validates conditional bytes and changed equal-size content', async () => {
    const target = { project: 'project-a', path: 'docs/a.txt' }
    const first = await client.read(target)
    expect(first.outcome).toBe('present')
    if (first.outcome !== 'present') throw new Error('expected content')
    expect(Buffer.from(first.content, 'base64').toString()).toBe('inside')
    const unchanged = await client.read(target, { knownVersion: first.version })
    expect(unchanged).toMatchObject({ outcome: 'unchanged', version: first.version })
    expect(unchanged).not.toHaveProperty('content')
    await writeFile(project.path('docs/a.txt'), 'edited')
    expect((await client.read(target, { knownVersion: first.version })).outcome).toBe('present')
  })

  it('uses interoperable listing versions and bounded ranges', async () => {
    const listing = await client.list({ project: 'project-a', path: 'docs' })
    expect(listing.outcome).toBe('present')
    if (listing.outcome !== 'present') throw new Error('expected listing')
    expect(listing.entries).toEqual([{ name: 'a.txt', kind: 'file' }])
    expect(
      (await client.list({ project: 'project-a', path: 'docs' }, { knownVersion: listing.version }))
        .outcome,
    ).toBe('unchanged')
    const range = await client.readRange({
      project: 'project-a',
      path: 'run.log',
      offset: 2,
      length: 3,
    })
    expect(range.outcome).toBe('present')
    if (range.outcome === 'present')
      expect(Buffer.from(range.content, 'base64').toString()).toBe('234')
  })

  it('retains opened bytes and metadata across atomic replacement, then refuses closed handles', async () => {
    const path = project.path('stable.bin')
    await writeFile(path, 'AAAAAA')
    const opened = await client.openRead({ project: 'project-a', path: 'stable.bin' })
    if (opened.outcome !== 'present') throw new Error('missing fixture')
    const lease = { project: 'project-a', readToken: opened.readToken }
    expect(opened.metadata.size).toBe(6)
    const first = await client.readAt({ ...lease, offset: 0, length: 3 })
    await writeFile(`${path}.next`, 'BBBBBBBBB')
    await rename(`${path}.next`, path)
    const second = await client.readAt({ ...lease, offset: 3, length: 10 })
    expect(
      Buffer.from(first.content, 'base64').toString() +
        Buffer.from(second.content, 'base64').toString(),
    ).toBe('AAAAAA')
    expect(second.extent).toBe(6)
    await client.closeRead(lease)
    await client.closeRead(lease)
    await expect(client.readAt({ ...lease, offset: 0, length: 1 })).rejects.toMatchObject({
      code: 'READ_HANDLE_EXPIRED',
    })
  })

  it('replays an atomic write and refuses stale expected fingerprints', async () => {
    const target = { project: 'project-a', path: 'docs/a.txt' }
    const before = await client.read(target)
    const metadata = await client.stat(target)
    if (before.outcome !== 'present' || metadata.outcome !== 'present')
      throw new Error('expected file')
    const local = await stat(project.path('docs/a.txt'))
    expect(metadata.metadata.mtimeMs).toBe(local.mtimeMs)
    const request = {
      ...target,
      operation: 'replace' as const,
      requestId: 'write-1',
      lockVersion: 1 as const,
      precondition: {
        kind: 'match' as const,
        expectedMtime: metadata.metadata.mtimeMs,
        expectedHash: before.version.slice(7),
      },
      content: Buffer.from('new').toString('base64'),
    }
    await client.mutate(request)
    await client.mutate(request)
    expect(await readFile(project.path('docs/a.txt'), 'utf8')).toBe('new')
    await expect(client.mutate({ ...request, requestId: 'write-2' })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(client.mutate({ ...request, content: 'eA==' })).rejects.toMatchObject({
      code: 'REPLAY_CONFLICT',
    })
    expect(contentVersion(Buffer.from('new'))).not.toBe(before.version)
  })

  it('retries a lost mutation reply with the same bound request without repeating a create', async () => {
    const transport = client as unknown as { call: (...args: unknown[]) => Promise<unknown> }
    const original = transport.call
    let lost = false
    const call = vi.spyOn(transport, 'call').mockImplementation(async (...args) => {
      const result = await Reflect.apply(original, client, args)
      if (args[0] === 'mutate' && !lost) {
        lost = true
        throw new FileAccessError('SOURCE_UNAVAILABLE')
      }
      return result
    })
    try {
      await client.mutate({
        project: 'project-a',
        path: 'lost-reply.txt',
        operation: 'replace',
        requestId: 'lost-reply',
        lockVersion: 1,
        precondition: { kind: 'absent' },
        content: 'eA==',
      })
      expect(call.mock.calls.filter(([operation]) => operation === 'mutate')).toHaveLength(2)
      expect(await readFile(project.path('lost-reply.txt'), 'utf8')).toBe('x')
    } finally {
      call.mockRestore()
    }
  })

  it('refuses unrelated projects and mismatched source identity', async () => {
    await expect(client.read({ project: 'project-b', path: 'docs/a.txt' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const wrong = new FileAgentClient({
      endpoint,
      ...credential,
      expectedSourceIdentity: 'source-b',
    })
    await expect(wrong.read({ project: 'project-a', path: 'docs/a.txt' })).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    })
  })

  it('rejects writes before touching a remapped source after a cached handshake', async () => {
    const replacement = await makeTempDir('memon-replaced-source-')
    const projects = config.projects as Record<string, Record<string, unknown>>
    await writeFile(
      configPath,
      JSON.stringify({
        ...config,
        projects: { 'project-a': { ...projects['project-a'], root: replacement } },
      }),
    )
    child.kill('SIGHUP')
    await expect
      .poll(async () => {
        try {
          await client.stat({ project: 'project-a', path: '' })
          return 'old'
        } catch (error) {
          return (error as { code?: string }).code
        }
      })
      .toBe('SOURCE_UNAVAILABLE')
    await expect(
      client.mutate({
        project: 'project-a',
        path: 'unintended.txt',
        operation: 'replace',
        content: 'eA==',
        precondition: { kind: 'absent' },
        requestId: 'remapped-write',
        lockVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' })
    await expect(stat(join(replacement, 'unintended.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await writeFile(configPath, JSON.stringify(config))
    child.kill('SIGHUP')
    await expect
      .poll(async () => {
        try {
          return (await client.stat({ project: 'project-a', path: '' })).outcome
        } catch {
          return 'waiting'
        }
      })
      .toBe('present')
  })

  it('refuses guarded directory moves before mutation when an older agent lacks the capability', async () => {
    const legacy = new FileAgentClient({
      endpoint,
      ...credential,
      expectedSourceIdentity: client.sourceIdentity,
    })
    const call = vi
      .spyOn(legacy as unknown as { call: (...args: unknown[]) => Promise<unknown> }, 'call')
      .mockResolvedValue({
        status: 200,
        headers: {},
        bytes: Buffer.from(
          JSON.stringify({
            protocolMajor: 1,
            sourceIdentity: client.sourceIdentity,
            writerLockVersion: 1,
            capabilities: ['read', 'list', 'stat', 'range', 'mutate', 'replay'],
            limits: {
              maxBodyBytes: 1024,
              maxRangeBytes: 1024,
              maxBatchItems: 10,
              maxConcurrent: 2,
              replayRetentionMs: 1000,
            },
          }),
        ),
      })
    await expect(
      legacy.openRead({ project: 'project-a', path: 'docs/a.txt' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    await expect(
      legacy.mutate({
        project: 'project-a',
        path: 'docs',
        operation: 'rename',
        requestId: 'guarded-move',
        lockVersion: 1,
        precondition: { kind: 'directory', expectedIdentity: contentVersion(Buffer.from('entry')) },
        destination: 'moved',
        destinationPrecondition: { kind: 'absent' },
        fileChecks: [
          {
            path: 'docs/a.txt',
            precondition: { kind: 'match', expectedMtime: 1, expectedHash: 'a'.repeat(64) },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    expect(call).toHaveBeenCalledTimes(1)
    expect(call.mock.calls[0]?.[0]).toBe('capabilities')
  })

  it('omits an empty guard extension when using an older baseline agent', async () => {
    const legacy = new FileAgentClient({
      endpoint,
      ...credential,
      expectedSourceIdentity: client.sourceIdentity,
    })
    const call = vi
      .spyOn(legacy as unknown as { call: (...args: unknown[]) => Promise<unknown> }, 'call')
      .mockImplementation(async (operation) => ({
        status: 200,
        headers: {},
        bytes: Buffer.from(
          JSON.stringify(
            operation === 'capabilities'
              ? {
                  protocolMajor: 1,
                  sourceIdentity: client.sourceIdentity,
                  writerLockVersion: 1,
                  capabilities: ['read', 'list', 'stat', 'range', 'mutate', 'replay'],
                  limits: {
                    maxBodyBytes: 1024,
                    maxRangeBytes: 1024,
                    maxBatchItems: 10,
                    maxConcurrent: 2,
                    replayRetentionMs: 1000,
                  },
                }
              : { outcome: 'applied' },
          ),
        ),
      }))
    await legacy.mutate({
      project: 'project-a',
      path: 'docs',
      operation: 'rename',
      requestId: 'baseline-move',
      lockVersion: 1,
      precondition: { kind: 'directory', expectedIdentity: contentVersion(Buffer.from('entry')) },
      destination: 'moved',
      destinationPrecondition: { kind: 'absent' },
      fileChecks: [],
    })
    expect(call.mock.calls[1]?.[2]).not.toHaveProperty('fileChecks')
  })

  it('remains installed while revoked grants are reloaded', async () => {
    const opened = await client.openRead({ project: 'project-a', path: 'docs/a.txt' })
    if (opened.outcome !== 'present') throw new Error('missing fixture')
    const pid = child.pid
    await writeFile(configPath, JSON.stringify({ ...config, grants: {} }))
    child.kill('SIGHUP')
    await expect
      .poll(async () => {
        try {
          await client.read({ project: 'project-a', path: 'docs/a.txt' })
          return 'allowed'
        } catch (error) {
          return (error as { code?: string }).code
        }
      })
      .toBe('FORBIDDEN')
    await expect(
      client.readAt({ project: 'project-a', readToken: opened.readToken, offset: 0, length: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(child.pid).toBe(pid)
    expect(child.exitCode).toBeNull()
  })
})
