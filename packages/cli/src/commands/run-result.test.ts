import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it } from 'vitest'
import { captureCli } from '../test-support/results-project.js'
import { runShow } from './show.js'

afterEach(removeTempDirs)

it('reads historical result rows without a mutation or schema conversion', async () => {
  const project = await createTempProject({
    runs: {
      'logs/trial-261020-080000': {
        'README.md': '---\nid: trial-261020-080000\nstatus: FINISHED\n---\n',
        'result.csv':
          'path,stat,value\n$experiment_schema_version,,1\nmetrics.loss,mean,0.2\nmetrics.loss,std,0.01\n',
      },
    },
  })
  const output = await captureCli(() =>
    runShow({
      projectRoot: project.root,
      cwd: project.root,
      format: 'json',
      id: 'logs/trial-261020-080000',
      results: true,
    }),
  )
  expect(output.exitCode).toBe(0)
  expect(output.json.experimentSchemaVersion).toBe(1)
  expect(output.json.rows.map((row: { stat: string }) => row.stat)).toEqual(['mean', 'std'])
})

it('exposes malformed result diagnostics through the normal read interface', async () => {
  const project = await createTempProject({
    runs: {
      'logs/E0001/V0001/trial': {
        'run.json': JSON.stringify({
          id: 'trial',
          status: 'READY',
          active: true,
          created_at: '2026-10-20T08:00:00+08:00',
        }),
        'result.csv': 'invalid,header\n',
      },
    },
  })
  const output = await captureCli(() =>
    runShow({
      projectRoot: project.root,
      cwd: project.root,
      format: 'json',
      id: 'logs/E0001/V0001/trial',
      results: true,
    }),
  )
  expect(output.json.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ severity: 'error' })]),
  )
})
