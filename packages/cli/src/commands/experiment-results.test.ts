import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runExperimentResults } from './experiment-results.js'

const RESULTS_YAML = `schema_version: 1
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

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

function spyExit() {
  const real = process.exit
  process.exit = ((code?: number) => {
    throw new ExitCalled(code ?? 0)
  }) as typeof process.exit
  return { restore: () => { process.exit = real } }
}

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
    expect(out.rows).toHaveLength(3)
    expect(out.meta.totalVariants).toBe(3)
    expect(out.meta.filteredVariants).toBe(3)
    expect(out.rows[0]!.values.precision).toBe('bf16')
    expect(out.rows[0]!.values.accuracy).toBe(0.95)
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
    expect(lines[0]).toBe('variant_id,variant_name,status,precision,accuracy,loss,runs_count,attempts_count')
    expect(lines[1]).toBe('V0001,BF16,COMPLETED,bf16,0.95,0.125,1,0')
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
    expect(lines[0]).toContain('Variant ID')
    expect(lines[0]).toContain('Variant Name')
    expect(lines[0]).toContain('Precision')
    expect(lines[1]).toContain('─')
    expect(lines[2]).toContain('**V0001**')
    expect(lines[2]).toContain('COMPLETED')
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
