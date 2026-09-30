import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BackendLogFilesResponseSchema,
  BackendLogLinesResponseSchema,
  BackendLogStreamEventSchema,
  type ProjectConfig,
} from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type BackendStreamServiceError, FilesystemStreamService } from './stream-service.js'

let workspace = ''
let rootA = ''
let rootB = ''
let service: FilesystemStreamService

beforeEach(async () => {
  workspace = await fs.mkdtemp(join(tmpdir(), 'memon-backend-stream-service-'))
  rootA = join(workspace, 'project-a')
  rootB = join(workspace, 'project-b')
  for (const root of [rootA, rootB]) {
    await Promise.all([
      fs.mkdir(join(root, 'logs', 'run-one', 'logs'), { recursive: true }),
      fs.mkdir(join(root, 'docs', 'reports', 'R0001-bundle', 'data'), { recursive: true }),
    ])
    await Promise.all([
      fs.writeFile(join(root, 'logs', 'run-one', 'README.md'), '# Run\n'),
      fs.writeFile(join(root, 'logs', 'run-one', 'train.log'), `${root === rootA ? 'a' : 'b'}1\n`),
      fs.writeFile(join(root, 'logs', 'run-one', 'logs', 'stderr.err'), 'error one\n'),
      fs.writeFile(join(root, 'logs', 'run-one', 'metrics.json'), '{}'),
      fs.writeFile(join(root, 'docs', 'reports', 'R0001-bundle', 'README.md'), '# Bundle\n'),
      fs.writeFile(
        join(root, 'docs', 'reports', 'R0001-bundle', 'data', 'metrics.json'),
        `{"project":"${root === rootA ? 'a' : 'b'}"}`,
      ),
    ])
  }
  await fs.writeFile(join(workspace, 'outside.log'), 'private\n')
  await fs.symlink(join(workspace, 'outside.log'), join(rootA, 'logs', 'run-one', 'leak.log'))
  await fs.symlink(
    join(workspace, 'outside.log'),
    join(rootA, 'docs', 'reports', 'R0001-bundle', 'leak.txt'),
  )
  const projects = [
    { name: 'project-a', root: rootA, include: [], exclude: [] },
    { name: 'project-b', root: rootB, include: [], exclude: [] },
  ] satisfies ProjectConfig[]
  service = new FilesystemStreamService(projects, { logStreamPollMs: 20 })
})

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true })
})

describe('FilesystemStreamService', () => {
  it('refuses a wiki asset request that does not name a W-id bundle', async () => {
    const assets = join(rootA, 'docs/wiki/assets')
    await fs.mkdir(assets, { recursive: true })
    await fs.writeFile(
      join(assets, 'pipeline-overview.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    )
    // The shared `docs/wiki/assets` figure convention is gone: figure images
    // live beside their document and are served by the document asset route.
    await expect(
      service.resolveWikiAsset('project-a', 'shared', 'pipeline-overview.svg'),
    ).rejects.toMatchObject({ code: 'INVALID_RESOURCE' })
  })
  it('lists only contained log files as portable resources', async () => {
    const files = BackendLogFilesResponseSchema.parse(
      await service.listLogFiles('project-a', 'logs/run-one/README.md'),
    )
    expect(files.files.map((file) => file.resource).sort()).toEqual([
      'logs/run-one/logs/stderr.err',
      'logs/run-one/train.log',
    ])
    expect(JSON.stringify(files)).not.toContain(rootA)
    expect(files.files.some((file) => file.name === 'leak.log')).toBe(false)
  })

  it('reads bounded line windows with Project isolation and rejects traversal/symlink escape', async () => {
    await fs.appendFile(join(rootA, 'logs', 'run-one', 'train.log'), 'a2\na3\n')
    const linesA = BackendLogLinesResponseSchema.parse(
      await service.readLogLines('project-a', 'logs/run-one/train.log', { count: 2 }),
    )
    const linesB = BackendLogLinesResponseSchema.parse(
      await service.readLogLines('project-b', 'logs/run-one/train.log', { count: 2 }),
    )
    expect(linesA.lines.map((line) => line.text)).toEqual(['a2', 'a3'])
    expect(linesB.lines.map((line) => line.text)).toEqual(['b1'])
    await expect(service.readLogLines('project-a', '../outside.log')).rejects.toMatchObject({
      code: 'INVALID_RESOURCE',
    } satisfies Partial<BackendStreamServiceError>)
    await expect(service.readLogLines('project-a', 'logs/run-one/leak.log')).rejects.toMatchObject({
      code: 'INVALID_RESOURCE',
    } satisfies Partial<BackendStreamServiceError>)
    await fs.writeFile(
      join(rootA, 'logs', 'run-one', 'huge.log'),
      Buffer.alloc(2 * 1024 * 1024, 0x61),
    )
    await expect(service.readLogLines('project-a', 'logs/run-one/huge.log')).rejects.toThrow(
      'selected log line exceeds byte limit',
    )
  })

  it('streams append events and stops promptly when the downstream signal aborts', async () => {
    const abort = new AbortController()
    const iterator = service
      .streamLog('project-a', 'logs/run-one/train.log', abort.signal)
      [Symbol.asyncIterator]()
    expect(BackendLogStreamEventSchema.parse((await iterator.next()).value)).toMatchObject({
      event: 'ready',
      data: { totalLines: 1 },
    })
    await fs.appendFile(join(rootA, 'logs', 'run-one', 'train.log'), 'a2\n')
    const appended = await iterator.next()
    expect(BackendLogStreamEventSchema.parse(appended.value)).toMatchObject({
      event: 'append',
      data: { lines: [{ lineNumber: 2, text: 'a2' }] },
    })
    abort.abort()
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
  })

  it('resolves Report assets without exposing paths and opens a bounded file stream', async () => {
    const asset = await service.resolveReportAsset('project-a', 'R0001', 'data/metrics.json')
    expect(asset.resource).toBe('docs/reports/R0001-bundle/data/metrics.json')
    expect(asset.contentType).toBe('application/json; charset=utf-8')
    expect(asset.etag).toMatch(/^W\/"[a-f0-9]{40}"$/)
    const chunks: Buffer[] = []
    for await (const chunk of service.openByteStream(asset)) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('{"project":"a"}')
    await expect(
      service.resolveReportAsset('project-a', 'R0001', 'leak.txt'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESOURCE',
    } satisfies Partial<BackendStreamServiceError>)
    await expect(
      service.resolveReportAsset('project-a', 'R0001', '../README.md'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESOURCE',
    } satisfies Partial<BackendStreamServiceError>)
    const projectB = await service.resolveReportAsset('project-b', 'R0001', 'data/metrics.json')
    const bChunks: Buffer[] = []
    for await (const chunk of service.openByteStream(projectB)) bChunks.push(Buffer.from(chunk))
    expect(Buffer.concat(bChunks).toString()).toBe('{"project":"b"}')
  })
})
