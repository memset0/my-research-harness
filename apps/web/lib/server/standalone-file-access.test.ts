// @vitest-environment node
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BackendReadmeResponseSchema,
  BackendRunResponseSchema,
  type Config,
  DEFAULT_GIT_STATUS,
  DEFAULT_SLURM,
} from '@memon/core'
import { FileAgentClient } from '@memon/file-protocol/client'
import { fileProjectURI } from '@memon/file-protocol/paths'
import { createTempProject, removeTempDirs, startFileAgentFixture } from '@memon/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { withStandaloneRequest } from './standalone-request'
import { standaloneServices } from './standalone-services'
import { standaloneRunTarget } from './standalone-target'

const run = 'run-one-261006-010203'
const resource = `logs/${run}/README.md`
const markdown = `---\nid: ${run}\nname: Run one\nentry: script.py\ncommand: python script.py\nstatus: FINISHED\narchived: false\nupdated_at: 2026-10-06T01:02:03+00:00\n---\n\n# Run one\n`
let source: Awaited<ReturnType<typeof createTempProject>>
let agent: Awaited<ReturnType<typeof startFileAgentFixture>>
let configurations: Config[]
beforeAll(async () => {
  source = await createTempProject({
    files: { [resource]: markdown, [`logs/${run}/stdout.log`]: 'one\ntwo\n' },
  })
  agent = await startFileAgentFixture(source.root)
  const client = new FileAgentClient({
    endpoint: agent.endpoint,
    ca: await readFile(agent.tls.ca),
    certificate: await readFile(agent.tls.client),
    key: await readFile(agent.tls.clientKey),
    expectedSourceIdentity: agent.sourceIdentity,
  })
  await vi.waitFor(() => client.stat({ project: 'project-a', path: '' }), { timeout: 10_000 })
  const config = (root: string): Config => ({
    projects: [{ name: 'project-a', root, include: ['logs/*'], exclude: [], storage: 'local' }],
    poll: { minIntervalMs: 1000, maxIntervalMs: 300_000, backoffFactor: 2 },
    slurm: { ...DEFAULT_SLURM },
    gitStatus: { ...DEFAULT_GIT_STATUS },
  })
  const direct = config(source.root)
  const memory = config(source.root)
  memory.projects[0]!.access = { kind: 'filesystem', cache: 'memory' }
  const remote = config(fileProjectURI('agent-a', 'project-a'))
  remote.projects[0]!.access = {
    kind: 'agent',
    cache: 'memory-disk',
    connection: 'agent-a',
    project: 'project-a',
    sourceIdentity: agent.sourceIdentity,
  }
  remote.fileAgents = {
    'agent-a': {
      endpoint: agent.endpoint,
      caFile: agent.tls.ca,
      certificateFile: agent.tls.client,
      keyFile: agent.tls.clientKey,
    },
  }
  configurations = [direct, memory, remote]
}, 40_000)
afterAll(async () => {
  await agent?.stop()
  await removeTempDirs()
})

describe('unqualified entries use shared file primitives', () => {
  it('reads native, native memory and real-agent Run documents without a host', async () => {
    for (const config of configurations) {
      const service = standaloneServices(config)
      const detail = BackendRunResponseSchema.parse(await service.projects.getRun('project-a', run))
      expect(detail.resource).toBe(resource)
      const readme = BackendReadmeResponseSchema.parse(
        await service.documents.getReadme('project-a', resource),
      )
      expect(readme.content).toBe(markdown)
      const resolved = await standaloneRunTarget(config, run)
      expect(resolved.project.host).toBeUndefined()
      expect(resolved.value.resource).toBe(resource)
    }
  })
  it('writes with remote optimistic locks and returns a real conflict', async () => {
    const service = standaloneServices(configurations[2]!)
    const current = BackendReadmeResponseSchema.parse(
      await service.documents.getReadme('project-a', resource),
    )
    const input = {
      content: markdown.replace('# Run one', '# Updated'),
      expectedMtime: current.mtime,
      expectedHash: current.hash,
    }
    await service.mutations.writeRunReadme('project-a', run, input)
    expect(await readFile(join(source.root, resource), 'utf8')).toContain('# Updated')
    await expect(
      service.mutations.writeRunReadme('project-a', run, {
        ...input,
        content: markdown + '\nDifferent stale edit\n',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await writeFile(join(source.root, resource), markdown)
  })
  it('streams logs through the agent while the iterator is pulled outside its creation scope', async () => {
    const service = standaloneServices(configurations[2]!).streaming
    const signal = new AbortController()
    const iterator = service
      .streamLog('project-a', `logs/${run}/stdout.log`, signal.signal)
      [Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ event: 'ready' })
    signal.abort()
    await iterator.return?.()
  })
  it('checks credentials before a warm summary index can answer', async () => {
    const service = standaloneServices(configurations[2]!).projects
    await service.listRuns('project-a')
    const key = await readFile(agent.tls.clientKey)
    try {
      await writeFile(agent.tls.clientKey, 'invalid private key')
      await expect(service.listRuns('project-a')).rejects.toMatchObject({
        code: 'SOURCE_UNAVAILABLE',
      })
    } finally {
      await writeFile(agent.tls.clientKey, key)
    }
    await expect(service.listRuns('project-a')).resolves.toBeDefined()
  })
  it('versions unqualified responses and reuses their content with honest freshness', async () => {
    const config = configurations[2]!
    const handle = withStandaloneRequest(async (_request: Request) =>
      Response.json(await standaloneServices(config).documents.getReadme('project-a', resource)),
    )
    const url = 'http://localhost/api/readme?project=project-a'
    const first = await handle(
      new Request(url, { headers: { 'x-memon-role': 'owner', 'x-memon-attention': 'page-a' } }),
    )
    expect(first.status).toBe(200)
    const status = JSON.parse(first.headers.get('x-memon-file-status')!)
    expect(status.oldestVerifiedAt).toBeTypeOf('number')
    const again = await handle(
      new Request(url, {
        headers: {
          'x-memon-role': 'owner',
          'x-memon-attention': 'page-a',
          'x-memon-known-version': first.headers.get('x-memon-resource-version')!,
        },
      }),
    )
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
    expect(again.headers.get('x-memon-epoch')).toBe(first.headers.get('x-memon-epoch'))
  })
})
