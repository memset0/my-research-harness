// @vitest-environment node

import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../../lib/server/experiment-sections', () => ({
  buildExperimentDocumentView: vi.fn(() => ({
    sections: [],
    diagnostics: [],
    readOnly: false,
  })),
}))

import { getRuntime } from '../../../../lib/runtime'
import { GET } from './route'

const EXPERIMENT_ID = 'E0001-detail-results-time'
let directory: string
let resultsPath: string

beforeEach(async () => {
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'memon-exp-detail-results-'))
  resultsPath = join(directory, 'results.yaml')
  await writeFile(resultsPath, 'schema_version: 1\ncolumns: []\nvariants: []\n')
  vi.mocked(getRuntime).mockResolvedValue({
    experiments: new Map([
      [
        EXPERIMENT_ID,
        {
          id: EXPERIMENT_ID,
          project: 'research',
          path: join(directory, 'README.md'),
          mtime: 1,
          readmeMtime: 1,
          frontMatter: {
            runs: [],
            createdAt: '2026-08-23T00:00:00.000Z',
            updatedAt: '2026-08-23T00:00:00.000Z',
          },
          sections: {},
          rawSections: [],
          documents: { results: { exists: true, path: resultsPath } },
          warningsRaw: null,
          parseErrors: [],
          parseWarnings: [],
        },
      ],
    ]),
    index: { get: vi.fn() },
  } as never)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('GET /api/experiments/:id Results timestamp', () => {
  it('includes the Results source mtime without a snapshot-read timestamp', async () => {
    const modifiedAt = new Date('2026-08-23T04:20:00.000Z')
    await utimes(resultsPath, modifiedAt, modifiedAt)

    const response = await GET(
      new NextRequest(`http://localhost/api/experiments/${EXPERIMENT_ID}`),
      { params: Promise.resolve({ id: EXPERIMENT_ID }) },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.resultsUpdatedAt).toBe(modifiedAt.toISOString())
    expect(body).not.toHaveProperty('resultsSnapshotAt')
  })

  it('uses a null source timestamp when managed Results are absent', async () => {
    const runtime = await getRuntime()
    const experiment = runtime.experiments.get(EXPERIMENT_ID) as {
      documents: { results: { exists: boolean; path: string } }
    }
    experiment.documents.results.exists = false

    const response = await GET(
      new NextRequest(`http://localhost/api/experiments/${EXPERIMENT_ID}`),
      { params: Promise.resolve({ id: EXPERIMENT_ID }) },
    )
    await expect(response.json()).resolves.toMatchObject({ resultsUpdatedAt: null })
  })
})
