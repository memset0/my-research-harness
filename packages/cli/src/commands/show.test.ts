import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { captureCli } from '../test-support/results-project.js'
import { runProjectInit } from './project.js'
import { runShow } from './show.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})

it('reads an explicit JSON Run without walking or reading unrelated Runs', async () => {
  const run = 'logs/E0001/V0001/trial'
  const project = await createTempProject({
    runs: {
      [run]: {
        'run.json': JSON.stringify({
          id: 'trial',
          status: 'QUEUED',
          active: true,
          created_at: '2026-10-20T08:00:00+08:00',
        }),
      },
      'logs/E0002/V0001/broken': { 'run.json': 'invalid metadata' },
    },
  })
  const read = vi.spyOn(fs, 'readFile')
  const walk = vi.spyOn(fs, 'readdir')
  const result = await captureCli(() =>
    runShow({
      projectRoot: project.root,
      cwd: project.root,
      format: 'json',
      id: run,
    }),
  )
  expect(result.exitCode).toBe(0)
  expect(result.json.metadata.status).toBe('QUEUED')
  expect(
    [...read.mock.calls, ...walk.mock.calls].some(([path]) => String(path).includes('/logs/E0002')),
  ).toBe(false)
})

it('keeps legacy README inspection available', async () => {
  const run = 'logs/trial-261020-080000'
  const project = await createTempProject({
    runs: { [run]: { 'README.md': '---\nstatus: FINISHED\n---\n\nA useful result.\n' } },
  })
  const output = await captureCli(() =>
    runShow({
      projectRoot: project.root,
      cwd: project.root,
      format: 'human',
      id: run,
    }),
  )
  expect(output.exitCode).toBe(0)
  expect(output.stdout).toContain('A useful result.')
})

it('rejects an ambiguous ID without choosing or hydrating a Run', async () => {
  const metadata = JSON.stringify({
    id: 'trial',
    status: 'READY',
    active: true,
    created_at: '2026-10-20T08:00:00+08:00',
  })
  const project = await createTempProject({
    runs: {
      'logs/E0001/V0001/trial': { 'run.json': metadata },
      'logs/E0001/V0002/trial': { 'run.json': metadata },
    },
  })
  const base = { projectRoot: project.root, cwd: project.root, format: 'json' as const }
  expect((await captureCli(() => runProjectInit(base))).exitCode).toBe(0)
  const read = vi.spyOn(fs, 'readFile')
  await expect(captureCli(() => runShow({ ...base, id: 'trial' }))).rejects.toThrow(
    'Ambiguous Run ID',
  )
  expect(read.mock.calls.some(([path]) => String(path).endsWith('/run.json'))).toBe(false)
})
