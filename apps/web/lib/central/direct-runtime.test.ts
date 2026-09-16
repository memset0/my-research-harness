// @vitest-environment node

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Config,
  DEFAULT_SLURM,
  DEFAULT_GIT_STATUS,
  type FileOperationMetrics,
  getFileOperationMetrics,
  getProjectFileContext,
  loadConfig,
  type ProjectConfig,
} from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetDirectCentralRuntimeForTests,
  directCentralRuntime,
  REASON_HEADER,
} from './direct-runtime'

const RUN_ID = 'run-one-260901-010203'

let root = ''
let storageGroup = ''
let config: Config

beforeEach(async () => {
  __resetDirectCentralRuntimeForTests()
  root = await fs.mkdtemp(join(tmpdir(), 'memon-direct-reason-'))
  storageGroup = `direct-reason-${root}`
  await fs.mkdir(join(root, 'logs', RUN_ID), { recursive: true })
  await fs.writeFile(
    join(root, 'logs', RUN_ID, 'README.md'),
    `---
id: ${RUN_ID}
name: Run one
entry: script.py
command: python script.py
status: FINISHED
archived: false
updated_at: 2026-09-01T01:02:03+00:00
---

# Run one
`,
  )
  config = {
    projects: [
      {
        name: 'research',
        root,
        host: 'local',
        storageGroup,
        include: ['logs/*'],
        exclude: [],
      },
    ],
    poll: { minIntervalMs: 1000, maxIntervalMs: 60_000, backoffFactor: 2 },
    slurm: { ...DEFAULT_SLURM },
    gitStatus: { ...DEFAULT_GIT_STATUS },
  }
})

afterEach(async () => {
  __resetDirectCentralRuntimeForTests()
  await fs.rm(root, { recursive: true, force: true })
})

function activity(metrics: FileOperationMetrics, origin: 'human' | 'automatic'): number {
  return metrics.series
    .filter((series) => series.storageGroup === storageGroup && series.origin === origin)
    .reduce((total, series) => total + series.samples + series.cacheHits, 0)
}

describe('direct central resource priority', () => {
  it('classifies central-owned JSON reads from the resource path, not a spoofed reason', async () => {
    const runtime = directCentralRuntime(config)
    const observed: Array<string | undefined> = []
    for (const [method, path] of [
      ['GET', '/api/wiki/backlinks/W0002'],
      ['HEAD', '/api/wiki/backlinks/W0002'],
      ['POST', '/api/wiki/backlinks/W0002'],
      ['GET', '/api/wiki/W0002'],
    ] as const) {
      const response = await runtime.readJsonResource(
        {
          host: 'local',
          project: 'research',
          request: new Request(`http://central.test${path}`, {
            method,
            headers: { [REASON_HEADER]: 'manual' },
          }),
        },
        async () => {
          observed.push(getProjectFileContext()?.reason)
          return { ok: true }
        },
      )
      expect(response).not.toBeNull()
    }
    expect(observed).toEqual(['automatic', 'automatic', 'write', 'manual'])
  })

  it('keeps dispatched collection reads automatic while a detail target stays human', async () => {
    const runtime = directCentralRuntime(config)
    const beforeCollection = getFileOperationMetrics()
    const collection = await runtime.dispatch({
      request: new Request(
        'http://central.test/api/hypotheses?host=local&project=research',
        { headers: { [REASON_HEADER]: 'manual' } },
      ),
      actor: { role: 'owner' },
    })
    expect(collection.status).toBe(200)
    const afterCollection = getFileOperationMetrics()
    expect(activity(afterCollection, 'automatic')).toBeGreaterThan(
      activity(beforeCollection, 'automatic'),
    )
    expect(activity(afterCollection, 'human')).toBe(activity(beforeCollection, 'human'))

    const detail = await runtime.dispatch({
      request: new Request(`http://central.test/api/runs/${RUN_ID}?host=local&project=research`, {
        headers: { [REASON_HEADER]: 'manual' },
      }),
      actor: { role: 'owner' },
    })
    expect(detail.status).toBe(200)
    const afterDetail = getFileOperationMetrics()
    expect(activity(afterDetail, 'human')).toBeGreaterThan(activity(afterCollection, 'human'))
  })
})

describe('direct central storage mode', () => {
  /** The storage mode the request context carried, or `'no-context'`. */
  async function contextStorage(projects: readonly ProjectConfig[]): Promise<unknown> {
    // The runtime is process-global and memoised, so a second config needs a
    // reset to be seen at all.
    __resetDirectCentralRuntimeForTests()
    const runtime = directCentralRuntime({ ...config, projects: [...projects] })
    let observed: unknown = 'no-context'
    const response = await runtime.readJsonResource(
      {
        host: 'local',
        project: 'research',
        request: new Request('http://central.test/api/wiki/W0002', {
          headers: { [REASON_HEADER]: 'manual' },
        }),
      },
      async () => {
        observed = getProjectFileContext()?.storage
        return { ok: true }
      },
    )
    expect(response).not.toBeNull()
    return observed
  }

  const base = { name: 'research', root: '', host: 'local', include: ['logs/*'], exclude: [] }

  it('declares a local project so the store reads it directly', async () => {
    await expect(contextStorage([{ ...base, root, storage: 'local' }])).resolves.toBe('local')
  })

  it('keeps an sshfs project on the scheduler', async () => {
    await expect(
      contextStorage([{ ...base, root, storageGroup, storage: 'sshfs' }]),
    ).resolves.toBe('sshfs')
  })

  it('leaves the mode unset when a config was assembled without one', async () => {
    // Only the loader defaults the mode; a hand-built ProjectConfig leaves it
    // undefined, which the store reads as sshfs — existing callers keep the
    // scheduler they had before this key existed.
    await expect(contextStorage([{ ...base, root, storageGroup }])).resolves.toBeUndefined()
  })

  it('serves a configured project as local when the config file omits `storage:`', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'memon-direct-storage-'))
    const configPath = join(dir, 'config.yml')
    await fs.writeFile(
      configPath,
      `projects:
  - name: research
    root: ${root}
    host: local
    include: ['logs/*']
`,
    )
    await fs.chmod(configPath, 0o600)
    try {
      const loaded = await loadConfig({ explicitPath: configPath, cwd: dir })
      expect(loaded).not.toBeNull()
      await expect(contextStorage(loaded!.projects)).resolves.toBe('local')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
