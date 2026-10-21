// @vitest-environment node
// Native (in-process) coverage only: File Agent transport is covered by the
// independently built agent, never by a unit test that builds Go.
import {
  BackendReadmeResponseSchema,
  BackendRunResponseSchema,
  type Config,
  DEFAULT_GIT_STATUS,
  DEFAULT_SLURM,
} from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withStandaloneRequest } from './standalone-request'
import { standaloneServices } from './standalone-services'
import { standaloneRunTarget } from './standalone-target'

const run = 'run-one-261006-010203'
const resource = `logs/${run}/README.md`
const markdown = `---\nid: ${run}\nname: Run one\nentry: script.py\ncommand: python script.py\nstatus: FINISHED\narchived: false\nupdated_at: 2026-10-06T01:02:03+00:00\n---\n\n# Run one\n`
let configurations: Config[]
beforeAll(async () => {
  const source = await createTempProject({
    files: { [resource]: markdown, [`logs/${run}/stdout.log`]: 'one\ntwo\n' },
  })
  const config = (): Config => ({
    projects: [
      { name: 'project-a', root: source.root, include: ['logs/*'], exclude: [], storage: 'local' },
    ],
    poll: { minIntervalMs: 1000, maxIntervalMs: 300_000, backoffFactor: 2 },
    slurm: { ...DEFAULT_SLURM },
    gitStatus: { ...DEFAULT_GIT_STATUS },
  })
  const direct = config()
  const memory = config()
  memory.projects[0]!.access = { kind: 'filesystem', cache: 'memory' }
  configurations = [direct, memory]
})
afterAll(async () => {
  await removeTempDirs()
})

describe('unqualified entries use shared file primitives', () => {
  it('reads native and native-memory Run documents without a host', async () => {
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
  it('versions unqualified responses and reuses their content with honest freshness', async () => {
    const config = configurations[1]!
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
