import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type BackendCapabilities,
  BackendExperimentResponseSchema,
  BackendExperimentResultsResponseSchema,
  MANAGED_SECTION_POINTERS,
} from '@memon/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import {
  MAX_BACKEND_CONTROL_JSON_BYTES,
  MAX_BACKEND_EXPERIMENT_DOCUMENT_JSON_BYTES,
} from './http/paths.js'
import { FilesystemProjectService } from './project-service.js'
import { createBackendServer } from './server.js'

const TOKEN = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const OWNER = Buffer.from(JSON.stringify({ role: 'owner' })).toString('base64url')
const caps: BackendCapabilities = {
  projects: true,
  mutations: false,
  events: false,
  logStreaming: false,
  reportAssets: false,
  wikiAssets: false,
  git: false,
  shares: false,
  slurm: false,
}

/** Long enough to push a document over a bound, short of the 64 KiB field limit. */
const DESCRIPTION = 'x'.repeat(60_000)

function readme(id: string): string {
  return `---
id: ${id}
slug: ${id.slice(6)}
title: Bound fixture
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: 2026-10-01T00:00:00+00:00
updated_at: 2026-10-01T00:00:00+00:00
---

## Motivation

## Design

## Implementation

${MANAGED_SECTION_POINTERS.implementation}

## Investigation

${MANAGED_SECTION_POINTERS.investigation}

## Results

${MANAGED_SECTION_POINTERS.results}

## Findings

## Limitations

## Conclusion

## Warnings
`
}

function description(variants: number): string {
  return `${JSON.stringify({
    experiment_schema_version: 1,
    groups: {},
    columns: [],
    variants: Array.from({ length: variants }, (_, index) => ({
      id: `V${String(index + 1).padStart(4, '0')}`,
      name: `Variant ${index + 1}`,
      ...(index === 0 ? { status: 'BLOCKED' } : {}),
      description: DESCRIPTION,
      values: { 'env.LR': 0.000008 },
      runs: [],
    })),
  })}\n`
}

async function writeExperiment(root: string, id: string, variants: number): Promise<void> {
  const bundle = join(root, 'docs', 'experiments', id)
  await fs.mkdir(bundle, { recursive: true })
  await fs.writeFile(join(bundle, 'README.md'), readme(id))
  await fs.writeFile(join(bundle, 'implementation.yaml'), 'schema_version: 1\nitems: []\n')
  await fs.writeFile(join(bundle, 'investigation.yaml'), 'schema_version: 1\nitems: []\n')
  await fs.writeFile(join(bundle, 'experiment.json'), description(variants))
}

let root = ''
let origin = ''
let server: ReturnType<typeof createBackendServer> | null = null

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-document-bound-'))
  // 30 × 60 KB descriptions: above the 1 MiB control bound, far below 16 MiB.
  await writeExperiment(root, 'E0001-large', 30)
  // 300 × 60 KB descriptions: above the 16 MiB document bound.
  await writeExperiment(root, 'E0002-huge', 300)
  // 1,000 Runs whose summaries together exceed 1 MiB on one page.
  const command = `python train.py ${'--flag value '.repeat(100)}`
  for (let index = 0; index < 1000; index += 1) {
    const run = join(root, 'logs', `bound${index}-261001-000000`)
    await fs.mkdir(run, { recursive: true })
    await fs.writeFile(
      join(run, 'README.md'),
      `---\nname: bound${index}\nstatus: FINISHED\ncommand: ${JSON.stringify(command)}\n---\n`,
    )
  }
  server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: TOKEN },
    capabilities: caps,
    revision: 'revision-a',
    projectService: new FilesystemProjectService([
      { name: 'bound', root, include: [], exclude: [] },
    ]),
  })
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 60_000)

afterAll(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()))
  if (root) await fs.rm(root, { recursive: true, force: true })
})

function get(path: string) {
  return fetch(`${origin}/api/backend/v1${path}`, {
    headers: { authorization: `Bearer ${TOKEN}`, [BACKEND_ACTOR_CONTEXT_HEADER]: OWNER },
  })
}

describe('Experiment document reads use the document response bound', () => {
  it('pins the two bounds', () => {
    expect(MAX_BACKEND_CONTROL_JSON_BYTES).toBe(1024 * 1024)
    expect(MAX_BACKEND_EXPERIMENT_DOCUMENT_JSON_BYTES).toBe(16 * 1024 * 1024)
  })

  it('serves a Results snapshot larger than 1 MiB', async () => {
    const response = await get('/experiments/E0001-large/results?project=bound')
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(Buffer.byteLength(text)).toBeGreaterThan(MAX_BACKEND_CONTROL_JSON_BYTES)
    const results = BackendExperimentResultsResponseSchema.parse(JSON.parse(text))
    expect(results.summary.variants).toHaveLength(30)
    expect(results.summary.variants[0]).toMatchObject({
      status: 'BLOCKED',
      cells: { 'env.LR': { kind: 'value', source: 'planned', value: '0.000008' } },
    })
    expect(
      results.summary.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'RESULTS_ENV_VALUE_COERCED',
      ),
    ).toHaveLength(30)
  }, 60_000)

  it('serves an Experiment detail larger than 1 MiB', async () => {
    const response = await get('/experiments/E0001-large?project=bound')
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(Buffer.byteLength(text)).toBeGreaterThan(MAX_BACKEND_CONTROL_JSON_BYTES)
    const detail = BackendExperimentResponseSchema.parse(JSON.parse(text))
    expect(detail.documents?.results.summary?.variants).toHaveLength(30)
  }, 60_000)

  it('still refuses a document over 16 MiB with a bounded PAYLOAD_TOO_LARGE', async () => {
    for (const path of [
      '/experiments/E0002-huge?project=bound',
      '/experiments/E0002-huge/results?project=bound',
    ]) {
      const response = await get(path)
      const text = await response.text()
      expect(response.status, path).toBe(500)
      expect(Buffer.byteLength(text), path).toBeLessThan(1024)
      expect(JSON.parse(text), path).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    }
  }, 120_000)

  it('keeps the 1 MiB control bound on the Run list', async () => {
    const page = await get('/runs?project=bound&limit=1000')
    expect(page.status).toBe(500)
    expect(await page.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    const firstPage = await get('/runs?project=bound&limit=200')
    expect(firstPage.status).toBe(200)
  }, 60_000)
})
