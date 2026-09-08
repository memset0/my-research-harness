// @vitest-environment node
import { BackendMutationError } from '@memon/backend'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('./standalone-services', () => ({ standaloneServices: vi.fn() }))
vi.mock('./standalone-mutation-refresh', () => ({
  refreshStandaloneRun: vi.fn(),
  refreshStandaloneExperiment: vi.fn(),
  refreshStandaloneJournal: vi.fn(),
}))
vi.mock('@memon/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@memon/core')>()),
  BackendRunResponseSchema: { parse: (value: unknown) => value },
  BackendExperimentResponseSchema: { parse: (value: unknown) => value },
  BackendReadmeResponseSchema: { parse: (value: unknown) => value },
}))

import { getRuntime } from '../runtime'
import { refreshStandaloneExperiment, refreshStandaloneRun } from './standalone-mutation-refresh'
import { readStandaloneReadme, writeStandaloneReadme } from './standalone-readme-route'
import { standaloneServices } from './standalone-services'

const getRun = vi.fn()
const getExperiment = vi.fn()
const getReadme = vi.fn()
const writeRunReadme = vi.fn()
const writeExperimentReadme = vi.fn()
const context = { params: Promise.resolve({ id: 'target-a' }) }

const request = (method: 'GET' | 'PUT', body?: unknown) =>
  new NextRequest('http://localhost/api/readme?project=project-a', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { projects: [{ name: 'project-a' }] },
  } as never)
  vi.mocked(standaloneServices).mockReturnValue({
    projects: { getRun, getExperiment },
    documents: { getReadme },
    mutations: { writeRunReadme, writeExperimentReadme },
  } as never)
  getRun.mockResolvedValue({ resource: 'logs/target-a/README.md' })
  getExperiment.mockResolvedValue({ resource: 'docs/experiments/target-a/README.md' })
  getReadme.mockResolvedValue({
    resource: 'logs/target-a/README.md',
    content: '# README',
    mtime: 1,
    hash: 'a'.repeat(40),
  })
  writeRunReadme.mockResolvedValue({
    ok: true,
    mtime: 2,
    hash: 'b'.repeat(40),
    finalContent: '# Updated',
    activityRecorded: false,
  })
  writeExperimentReadme.mockResolvedValue({
    ok: true,
    mtime: 2,
    hash: 'b'.repeat(40),
    finalContent: '# Updated',
    activityRecorded: true,
  })
})

describe('standalone dedicated README shared adapters', () => {
  it('reads a portable Run README and preserves the public DTO', async () => {
    const response = await readStandaloneReadme('run', request('GET'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      resource: 'logs/target-a/README.md',
      content: '# README',
      hash: 'a'.repeat(40),
    })
  })

  it('writes Run and Experiment README through shared mutation semantics', async () => {
    const body = { content: '# Updated', expectedMtime: 1 }
    expect((await writeStandaloneReadme('run', request('PUT', body), context)).status).toBe(200)
    expect(writeRunReadme).toHaveBeenCalledWith('project-a', 'target-a', {
      ...body,
      expectedHash: 'a'.repeat(40),
    })
    expect(refreshStandaloneRun).toHaveBeenCalled()
    expect((await writeStandaloneReadme('experiment', request('PUT', body), context)).status).toBe(
      200,
    )
    expect(writeExperimentReadme).toHaveBeenCalled()
    expect(refreshStandaloneExperiment).toHaveBeenCalled()
  })

  it('preserves optimistic conflict content', async () => {
    writeRunReadme.mockRejectedValue(
      new BackendMutationError('CONFLICT', 'changed', {
        mtime: 3,
        hash: 'c'.repeat(40),
        content: '# Current',
      }),
    )
    const response = await writeStandaloneReadme(
      'run',
      request('PUT', { content: '# Updated', expectedMtime: 1, expectedHash: 'a'.repeat(40) }),
      context,
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ mtime: 3, content: '# Current' })
  })
})
