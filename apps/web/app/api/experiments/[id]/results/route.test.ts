// @vitest-environment node

import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from '../../../../../lib/runtime'
import { GET } from './route'

const EXPERIMENT_ID = 'E0001-refresh-results'
const VALID_RESULTS = `schema_version: 1
columns:
  - key: loss
    label: Loss
    group: metric
    type: number
variants:
  - id: V0001
    name: Refreshed
    status: COMPLETED
    metrics:
      loss: 0.125
`

let directory: string
let resultsPath: string

beforeEach(async () => {
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'memon-results-refresh-'))
  resultsPath = join(directory, 'results.yaml')
  await writeFile(resultsPath, VALID_RESULTS)
  vi.mocked(getRuntime).mockResolvedValue({
    experiments: new Map([
      [
        EXPERIMENT_ID,
        {
          documents: {
            results: {
              exists: true,
              path: resultsPath,
              data: { schemaVersion: 1, columns: [], variants: [] },
            },
          },
        },
      ],
    ]),
  } as never)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function request(id = EXPERIMENT_ID) {
  return GET(new NextRequest(`http://localhost/api/experiments/${id}/results`), {
    params: Promise.resolve({ id }),
  })
}

describe('GET /api/experiments/:id/results', () => {
  it('reparses the current file and returns source and snapshot timestamps', async () => {
    const modifiedAt = new Date('2026-08-23T04:30:00.000Z')
    await utimes(resultsPath, modifiedAt, modifiedAt)

    const response = await request()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.document).toMatchObject({
      schemaVersion: 1,
      variants: [{ id: 'V0001', name: 'Refreshed', metrics: { loss: 0.125 } }],
    })
    expect(body.updatedAt).toBe(modifiedAt.toISOString())
    expect(Number.isNaN(Date.parse(body.snapshotAt))).toBe(false)
    expect(body.warnings).toEqual([])
  })

  it('returns 404 for an unknown Experiment or missing Results file', async () => {
    expect((await request('E9999-missing')).status).toBe(404)

    await rm(resultsPath)
    const response = await request()
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RESULTS_NOT_FOUND' },
    })
  })

  it('returns validation diagnostics without rewriting invalid YAML', async () => {
    const invalid = 'schema_version: 1\ncolumns: invalid\nvariants: []\n'
    await writeFile(resultsPath, invalid)

    const response = await request()
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_RESULTS' },
      diagnostics: [{ severity: 'error' }],
    })
    await expect(readFile(resultsPath, 'utf8')).resolves.toBe(invalid)
  })
})
