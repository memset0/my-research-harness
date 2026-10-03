// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from '../../../../../lib/server/runtime'
import { GET } from './route'

const EXPERIMENT_ID = 'E0001-refresh-results'
const RUN = 'logs/refresh-261001-000000'
const DESCRIPTION = `${JSON.stringify(
  {
    experiment_schema_version: 1,
    groups: {},
    columns: [{ path: 'metrics.loss', label: 'Loss', type: 'number', direction: 'lower' }],
    variants: [{ id: 'V0001', name: 'Refreshed', runs: [RUN] }],
  },
  null,
  2,
)}\n`

let directory: string
let descriptionPath: string
let resultPath: string

beforeEach(async () => {
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'memon-results-refresh-'))
  descriptionPath = join(directory, 'docs', 'experiments', EXPERIMENT_ID, 'experiment.json')
  resultPath = join(directory, RUN, 'result.csv')
  await mkdir(dirname(descriptionPath), { recursive: true })
  await mkdir(dirname(resultPath), { recursive: true })
  await writeFile(
    join(dirname(descriptionPath), 'README.md'),
    `---
id: ${EXPERIMENT_ID}
slug: refresh-results
title: Results refresh
status: OPEN
archived: false
runs: [${RUN}]
hypotheses: []
tags: []
created_at: 2026-08-23T00:00:00Z
updated_at: 2026-08-23T00:00:00Z
---

## Results

> Columns and Variants are managed in [experiment.json](./experiment.json); the Results table is generated from each member Run's result.csv.
`,
  )
  await writeFile(descriptionPath, DESCRIPTION)
  await writeFile(join(directory, RUN, 'README.md'), '---\nstatus: FINISHED\n---\n')
  await writeFile(
    resultPath,
    'path,stat,value\n$experiment_schema_version,,1\nmetrics.loss,,0.125\n',
  )
  vi.mocked(getRuntime).mockResolvedValue({
    config: {
      projects: [{ name: 'research', root: directory, include: [], exclude: [] }],
    },
    experiments: new Map(),
    projectFor: () => ({ name: 'research', root: directory }),
  } as never)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function request(id = EXPERIMENT_ID) {
  return GET(new NextRequest(`http://localhost/api/experiments/${id}/results?project=research`), {
    params: Promise.resolve({ id }),
  })
}

describe('GET /api/experiments/:id/results', () => {
  it('regenerates the summary from the current inputs and returns their newest time', async () => {
    const modifiedAt = new Date('2026-08-23T04:30:00.000Z')
    await utimes(descriptionPath, modifiedAt, modifiedAt)
    await utimes(resultPath, modifiedAt, modifiedAt)
    await utimes(join(directory, RUN, 'README.md'), modifiedAt, modifiedAt)

    const response = await request()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.summary).toMatchObject({
      outcome: 'ok',
      experimentSchemaVersion: 1,
      variants: [
        {
          id: 'V0001',
          name: 'Refreshed',
          status: 'COMPLETED',
          cells: { 'metrics.loss': { kind: 'value', value: 0.125 } },
        },
      ],
    })
    expect(new Date(body.updatedAt).getTime()).toBe(modifiedAt.getTime())
    expect(body).toMatchObject({
      project: 'research',
      resource: `docs/experiments/${EXPERIMENT_ID}/experiment.json`,
    })
    expect(body).not.toHaveProperty('snapshotAt')

    // A script rewrites the member's result file: the next snapshot shows it.
    await writeFile(
      resultPath,
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.loss,,0.25\n',
    )
    const refreshed = await (await request()).json()
    expect(refreshed.summary.variants[0].cells['metrics.loss'].value).toBe(0.25)
  })

  it('serves a BLOCKED Variant and reads an unquoted env number as a string', async () => {
    const source = `${JSON.stringify({
      experiment_schema_version: 1,
      groups: {},
      columns: [],
      variants: [
        {
          id: 'V0001',
          name: 'Waits for the parent checkpoint',
          status: 'BLOCKED',
          values: { 'env.LR': 0.000008 },
          runs: [],
        },
      ],
    })}\n`
    await writeFile(descriptionPath, source)

    const response = await request()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.summary.variants).toEqual([
      expect.objectContaining({
        id: 'V0001',
        status: 'BLOCKED',
        cells: { 'env.LR': { kind: 'value', source: 'planned', value: '0.000008' } },
      }),
    ])
    expect(
      body.summary.diagnostics.filter(
        (diagnostic: { code: string }) => diagnostic.code === 'RESULTS_ENV_VALUE_COERCED',
      ),
    ).toEqual([
      expect.objectContaining({
        severity: 'warning',
        field: 'variants.0.values.env.LR',
        message: expect.stringMatching(/^RESULTS_ENV_VALUE_COERCED: /),
      }),
    ])
    await expect(readFile(descriptionPath, 'utf8')).resolves.toBe(source)
  })

  it('returns 404 for an unknown Experiment or a missing description file', async () => {
    expect((await request('E9999-missing')).status).toBe(404)

    await rm(descriptionPath)
    await writeFile(join(dirname(descriptionPath), 'results.yaml'), 'schema_version: [broken\n')
    const response = await request()
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RESULTS_NOT_FOUND' },
      files: [{ file: `docs/experiments/${EXPERIMENT_ID}/experiment.json` }],
    })
  })

  it('returns validation diagnostics without rewriting an invalid description file', async () => {
    const invalid = '{"experiment_schema_version": 1, "columns": "invalid"}\n'
    await writeFile(descriptionPath, invalid)

    const response = await request()
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_RESULTS' },
      diagnostics: [{ severity: 'error' }],
    })
    await expect(readFile(descriptionPath, 'utf8')).resolves.toBe(invalid)
  })

  it('returns 422 RESULT_SCHEMA_MISMATCH with the offending file and the upgrade command', async () => {
    await writeFile(resultPath, 'path,stat,value\n$experiment_schema_version,,2\nmetrics.loss,,1\n')
    const response = await request()
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body).toMatchObject({
      error: { code: 'RESULT_SCHEMA_MISMATCH' },
      files: [{ file: `${RUN}/result.csv`, version: 2 }],
      upgradeCommand: `memon experiment schema upgrade ${EXPERIMENT_ID} --to 1`,
    })
    expect(JSON.stringify(body)).not.toContain('V0001')
  })

  it('returns 422 RESULT_DUPLICATE_ROW naming the duplicate lines', async () => {
    await writeFile(
      resultPath,
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.loss,,1\nmetrics.loss,,2\n',
    )
    const response = await request()
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RESULT_DUPLICATE_ROW' },
      files: [{ file: `${RUN}/result.csv`, duplicates: [{ key: 'metrics.loss', lines: [3, 4] }] }],
    })
  })
})
