import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { type ExitCalled, spyExit } from '@memon/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runExperimentDocumentLint, runExperimentDocumentRender } from './experiment-document.js'

import {
  runExperimentResults,
  runExperimentResultsAnnotationGet,
  runExperimentResultsAnnotationSet,
  runExperimentResultsSummary,
} from './experiment-results.js'

const RESULTS_YAML = `schema_version: 1
column_annotations:
  precision:
    description: Controls **training precision**.
    value_descriptions:
      bf16: Uses **bfloat16** arithmetic.
columns:
  - key: precision
    label: Precision
    group: parameter
    type: enum
    options: [fp32, bf16]
  - key: accuracy
    label: Accuracy
    group: metric
    type: number
  - key: loss
    label: Loss
    group: metric
    type: number
variants:
  - id: V0001
    name: BF16
    status: COMPLETED
    parameters: {precision: bf16}
    metrics: {accuracy: 0.95, loss: 0.125}
    runs: [run-a]
    attempts: []
  - id: V0002
    name: FP32
    status: RUNNING
    parameters: {precision: fp32}
    metrics: {accuracy: 0.88}
    runs: []
    attempts: [run-b]
  - id: V0003
    name: BF16-AMP
    status: FAILED
    parameters: {precision: bf16}
    metrics: {accuracy: null, loss: null}
    runs: []
    attempts: [run-c, run-d]
`

const BLOCKED_RESULTS_YAML = `schema_version: 1
columns:
  - key: accuracy
    label: Accuracy
    group: metric
    type: number
variants:
  - id: V0001
    name: Parent
    status: COMPLETED
    metrics: {accuracy: 0.9}
    provenance:
      entry: scripts/train.sh
      env:
        LR: 0.000008
  - id: V0002
    name: Child
    status: BLOCKED
    description: Waits for the V0001 checkpoint.
`

describe('experiment results CLI', () => {
  let root: string
  let stdout = ''
  let realWrite: typeof process.stdout.write
  let priorExitCode: typeof process.exitCode
  let exitSpy: ReturnType<typeof spyExit>

  beforeEach(async () => {
    root = await fs.mkdtemp(join(process.cwd(), 'memon-results-test-'))
    realWrite = process.stdout.write
    priorExitCode = process.exitCode
    process.exitCode = undefined
    exitSpy = spyExit()
    process.stdout.write = ((chunk: unknown) => {
      stdout += String(chunk)
      return true
    }) as typeof process.stdout.write
  })

  afterEach(async () => {
    process.stdout.write = realWrite
    process.exitCode = priorExitCode
    exitSpy.restore()
    await fs.rm(root, { recursive: true, force: true })
  })

  async function create(): Promise<string> {
    const expDir = join(root, 'docs', 'experiments', 'E0001-foo')
    await fs.mkdir(expDir, { recursive: true })
    await fs.writeFile(
      join(expDir, 'README.md'),
      `---
id: E0001-foo
slug: foo
title: Foo
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: '2026-08-10T12:00:00+00:00'
updated_at: '2026-08-10T12:00:00+00:00'
---

## Motivation

foo

## Design

foo

## Implementation

> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.

## Investigation

> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.

## Results

> Managed in [results.yaml](./results.yaml); read and update that file directly.

## Findings

foo

## Limitations

foo

## Conclusion

foo

## Warnings

foo
`,
    )
    await fs.writeFile(join(expDir, 'results.yaml'), RESULTS_YAML)
    return 'E0001-foo'
  }

  it('returns JSON with all variants and columns by default', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      columnGroup: 'all',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.experimentId).toBe('E0001-foo')
    expect(out.resultsSchemaVersion).toBe(1)
    expect(out.columns).toHaveLength(3)
    expect(out.columnAnnotations.precision.description).toContain('**training precision**')
    expect(out.rows).toHaveLength(3)
    expect(out.meta.totalVariants).toBe(3)
    expect(out.meta.filteredVariants).toBe(3)
    expect(out.rows[0]!.values.precision).toBe('bf16')
    expect(out.rows[0]!.values.accuracy).toBe(0.95)
  })

  it('excludes deprecated Run and Attempt references without rewriting source evidence', async () => {
    const id = await create()
    const path = join(root, 'docs', 'experiments', id, 'results.yaml')
    const selected = 'selected-260901-100000'
    const attempt = 'attempt-260901-100001'
    const source = RESULTS_YAML.replace('run-a', selected).replace('run-b', attempt)
    await fs.writeFile(path, source)
    for (const run of [selected, attempt]) {
      const dir = join(root, 'logs', run)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(dir, 'README.md'), '---\ndeprecated: true\n---\n')
    }
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: id,
      format: 'json',
      columnGroup: 'all',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.rows[0]).toMatchObject({
      runs: [],
      values: { accuracy: 0.95 },
      metricsValidity: 'unavailable',
    })
    expect(out.rows[1]).toMatchObject({ attempts: [], metricsValidity: 'valid' })
    expect(out.variantEligibility[0].runs).toEqual([selected])
    stdout = ''
    await runExperimentDocumentRender({
      projectRoot: root,
      cwd: root,
      idOrSlug: id,
      format: 'json',
      section: 'results',
    })
    const rendered = JSON.parse(stdout).markdown as string
    const rows = rendered.split('\n').filter((line) => line.startsWith('| **V'))
    expect(rows[0]).toContain('0.95')
    expect(rows[0]).toContain('unavailable')
    expect(rows.join('\n')).not.toContain(selected)
    expect(rows.join('\n')).not.toContain(attempt)
    expect(await fs.readFile(path, 'utf8')).toBe(source)
  })

  it('summarizes columns, annotations, and row identities without exposing cell values', async () => {
    await create()
    stdout = ''
    await runExperimentResultsSummary({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.meta).toEqual({ columnCount: 3, rowCount: 3 })
    expect(out.columns[0]).toMatchObject({
      key: 'precision',
      description: 'Controls **training precision**.',
      valueDescriptions: { bf16: 'Uses **bfloat16** arithmetic.' },
    })
    expect(out.rows[0]).toEqual({
      id: 'V0001',
      name: 'BF16',
      status: 'COMPLETED',
      metricsValidity: 'valid',
      deprecatedRuns: [],
    })
    expect(stdout).not.toContain('0.95')
    expect(stdout).not.toContain('run-a')
    expect(stdout).not.toContain('"parameters"')
    expect(stdout).not.toContain('"metrics"')
  })

  it('adds and replaces column/value annotations and reads them without requiring YAML edits', async () => {
    await create()
    stdout = ''
    await runExperimentResultsAnnotationSet({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      column: 'precision',
      description: 'Expanded **column** explanation.',
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, replaced: true, changed: true })

    stdout = ''
    await runExperimentResultsAnnotationSet({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      column: 'precision',
      value: 'fp4',
      description: 'A future value not yet present in `options`.',
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, replaced: false, value: 'fp4' })

    const written = await fs.readFile(
      join(root, 'docs', 'experiments', 'E0001-foo', 'results.yaml'),
      'utf8',
    )
    expect(written.indexOf('column_annotations:')).toBeLessThan(written.indexOf('columns:'))
    expect(written).toContain('future value not yet present')

    stdout = ''
    await runExperimentResultsAnnotationGet({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      column: 'precision',
      value: 'fp4',
    })
    expect(JSON.parse(stdout)).toEqual({
      experimentId: 'E0001-foo',
      column: 'precision',
      value: 'fp4',
      description: 'A future value not yet present in `options`.',
    })
  })

  it('filters by --variant', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      variants: 'V0001,V0003',
      columnGroup: 'all',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.rows).toHaveLength(2)
    expect(out.rows.map((r: { variantId: string }) => r.variantId)).toEqual(['V0001', 'V0003'])
  })

  it('filters by --status', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      statuses: 'COMPLETED,FAILED',
      columnGroup: 'all',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.rows).toHaveLength(2)
    expect(out.rows.map((r: { status: string }) => r.status)).toEqual(['COMPLETED', 'FAILED'])
  })

  it('selects BLOCKED Variants with a case-insensitive --status and reads numeric env values', async () => {
    const id = await create()
    await fs.writeFile(join(root, 'docs', 'experiments', id, 'results.yaml'), BLOCKED_RESULTS_YAML)
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: id,
      format: 'json',
      statuses: 'blocked',
      columnGroup: 'all',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(
      out.rows.map((r: { variantId: string; status: string }) => [r.variantId, r.status]),
    ).toEqual([['V0002', 'BLOCKED']])
    expect(out.meta).toMatchObject({
      totalVariants: 2,
      filteredVariants: 1,
      filters: { statuses: ['blocked'] },
    })

    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: id,
      format: 'json',
      columnGroup: 'all',
      output: 'markdown',
    })
    expect(stdout).toContain('BLOCKED')

    stdout = ''
    await runExperimentResultsSummary({
      projectRoot: root,
      cwd: root,
      idOrSlug: id,
      format: 'json',
      output: 'json',
    })
    expect(JSON.parse(stdout).rows.map((r: { status: string }) => r.status)).toEqual([
      'COMPLETED',
      'BLOCKED',
    ])
    expect(process.exitCode).toBeUndefined()
  })

  it('lints a coerced env value as a warning and exits 0', async () => {
    const id = await create()
    const dir = join(root, 'docs', 'experiments', id)
    await fs.writeFile(join(dir, 'implementation.yaml'), 'schema_version: 1\nitems: []\n')
    await fs.writeFile(join(dir, 'investigation.yaml'), 'schema_version: 1\nitems: []\n')
    await fs.writeFile(join(dir, 'results.yaml'), BLOCKED_RESULTS_YAML)
    stdout = ''
    await runExperimentDocumentLint({ projectRoot: root, cwd: root, idOrSlug: id, format: 'json' })
    const out = JSON.parse(stdout)
    expect(out).toMatchObject({ ok: true, summary: { errors: 0, warnings: 1 } })
    expect(out.diagnostics).toEqual([
      expect.objectContaining({
        code: 'RESULTS_ENV_VALUE_COERCED',
        severity: 'warning',
        field: 'variants.0.provenance.env.LR',
      }),
    ])
    expect(process.exitCode).toBeUndefined()
    expect(await fs.readFile(join(dir, 'results.yaml'), 'utf8')).toBe(BLOCKED_RESULTS_YAML)
  })

  it('filters by --column', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      columnGroup: 'all',
      columns: 'precision,loss',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.columns).toHaveLength(2)
    expect(out.columns.map((c: { key: string }) => c.key)).toEqual(['precision', 'loss'])
  })

  it('filters by --group parameter', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      columnGroup: 'parameter',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.columns).toHaveLength(1)
    expect(out.columns[0]!.key).toBe('precision')
    expect(out.columns[0]!.group).toBe('parameter')
  })

  it('filters by --group metric', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      columnGroup: 'metric',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.columns).toHaveLength(2)
    expect(out.columns.every((c: { group: string }) => c.group === 'metric')).toBe(true)
  })

  it('returns empty rows when no variants match filters', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      variants: 'V9999',
      columnGroup: 'all',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.rows).toHaveLength(0)
    expect(out.meta.filteredVariants).toBe(0)
    expect(out.meta.totalVariants).toBe(3)
  })

  it('emits CSV format', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      variants: 'V0001',
      columnGroup: 'all',
      output: 'csv',
    })
    const lines = stdout.trim().split('\n')
    expect(lines[0]).toBe(
      'variant_id,variant_name,status,precision,accuracy,loss,runs_count,attempts_count,metrics_validity,deprecated_runs',
    )
    expect(lines[1]).toBe('V0001,BF16,COMPLETED,bf16,0.95,0.125,1,0,valid,')
  })

  it('emits markdown format', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      variants: 'V0001',
      columnGroup: 'all',
      output: 'markdown',
    })
    const lines = stdout.trim().split('\n')
    expect(stdout).toContain('Column annotations:')
    const headerIndex = lines.findIndex((line) => line.includes('Variant ID'))
    expect(headerIndex).toBeGreaterThanOrEqual(0)
    expect(lines[headerIndex]).toContain('Variant Name')
    expect(lines[headerIndex]).toContain('Precision')
    expect(lines[headerIndex + 1]).toContain('─')
    expect(lines[headerIndex + 2]).toContain('**V0001**')
    expect(lines[headerIndex + 2]).toContain('COMPLETED')
  })

  it('emits human format', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      variants: 'V0001',
      columnGroup: 'all',
      output: 'human',
    })
    expect(stdout).toContain('experiment: E0001-foo')
    expect(stdout).toContain('**V0001**')
    expect(stdout).toContain('BF16')
    expect(stdout).toContain('COMPLETED')
    expect(stdout).toContain('bf16')
    expect(stdout).toContain('0.95')
  })

  it('emits YAML format', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      variants: 'V0001',
      columnGroup: 'all',
      output: 'yaml',
    })
    const out = JSON.parse(stdout)
    expect(out.experimentId).toBe('E0001-foo')
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]!.variantId).toBe('V0001')
  })

  it('handles combined filters', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      variants: 'V0001,V0002',
      statuses: 'COMPLETED',
      columnGroup: 'metric',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]!.variantId).toBe('V0001')
    expect(out.columns).toHaveLength(2)
    expect(out.columns.every((c: { group: string }) => c.group === 'metric')).toBe(true)
  })

  it('handles null values', async () => {
    await create()
    stdout = ''
    await runExperimentResults({
      projectRoot: root,
      cwd: root,
      idOrSlug: 'E0001-foo',
      format: 'json',
      variants: 'V0003',
      columnGroup: 'all',
      output: 'json',
    })
    const out = JSON.parse(stdout)
    expect(out.rows[0]!.values.accuracy).toBeNull()
    expect(out.rows[0]!.values.loss).toBeNull()
  })

  it('reports NOT_FOUND for missing experiment', async () => {
    await create()
    stdout = ''
    let caught: ExitCalled | undefined
    try {
      await runExperimentResults({
        projectRoot: root,
        cwd: root,
        idOrSlug: 'E9999-nonexistent',
        format: 'json',
        columnGroup: 'all',
        output: 'json',
      })
    } catch (err) {
      caught = err as ExitCalled
    }
    expect(caught).toBeDefined()
    expect(caught!.exitCode).toBe(4)
  })

  it('reports RESULTS_NOT_FOUND when results.yaml is missing', async () => {
    const expDir = join(root, 'docs', 'experiments', 'E0002-empty')
    await fs.mkdir(expDir, { recursive: true })
    await fs.writeFile(
      join(expDir, 'README.md'),
      `---
id: E0002-empty
slug: empty
title: Empty
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: '2026-08-10T12:00:00+00:00'
updated_at: '2026-08-10T12:00:00+00:00'
---

## Motivation

## Design

## Implementation

> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.

## Investigation

> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.

## Results

> Managed in [results.yaml](./results.yaml); read and update that file directly.

## Findings

## Limitations

## Conclusion

## Warnings
`,
    )
    stdout = ''
    let caught: ExitCalled | undefined
    try {
      await runExperimentResults({
        projectRoot: root,
        cwd: root,
        idOrSlug: 'E0002-empty',
        format: 'json',
        columnGroup: 'all',
        output: 'json',
      })
    } catch (err) {
      caught = err as ExitCalled
    }
    expect(caught).toBeDefined()
    expect(caught!.exitCode).toBe(4)
  })

  it('reports INVALID_RESULTS for malformed YAML', async () => {
    const expDir = join(root, 'docs', 'experiments', 'E0003-bad')
    await fs.mkdir(expDir, { recursive: true })
    await fs.writeFile(
      join(expDir, 'README.md'),
      `---
id: E0003-bad
slug: bad
title: Bad
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: '2026-08-10T12:00:00+00:00'
updated_at: '2026-08-10T12:00:00+00:00'
---

## Motivation

## Design

## Implementation

> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.

## Investigation

> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.

## Results

> Managed in [results.yaml](./results.yaml); read and update that file directly.

## Findings

## Limitations

## Conclusion

## Warnings
`,
    )
    await fs.writeFile(join(expDir, 'results.yaml'), 'not: valid: yaml: [')

    stdout = ''
    let caught: ExitCalled | undefined
    try {
      await runExperimentResults({
        projectRoot: root,
        cwd: root,
        idOrSlug: 'E0003-bad',
        format: 'json',
        columnGroup: 'all',
        output: 'json',
      })
    } catch (err) {
      caught = err as ExitCalled
    }
    expect(caught).toBeDefined()
    expect(caught!.exitCode).toBe(1) // INVALID_RESULTS → GENERIC fallback
  })
})
