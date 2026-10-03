import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LEGACY_RESULTS_POINTER, MANAGED_SECTION_POINTERS } from '../experiments/documents.js'
import { RESULT_ALLOW_RULES_COMMENT } from '../results/ignore.js'
import { loadResultsSummary } from '../results/summary-cache.js'
import {
  applyResultsMigration,
  planResultsMigration,
  type ResultsMigrationPlan,
  rollbackResultsMigration,
  V8_TO_V9_COMMIT_MESSAGE,
  verifyResultsMigration,
} from './v8-to-v9.js'
import { classifyV8Cell, columnConversion, convertedRows } from './v8-to-v9-values.js'

const roots: string[] = []
const MARKER_V8 =
  '{\n  "fs_convention_version": 8,\n  "installed_at": "2026-09-01T09:00:00+08:00",\n  "last_migrated_at": null,\n  "custom": "keep"\n}\n'

const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

async function write(root: string, rel: string, content: string) {
  await fs.mkdir(join(root, rel, '..'), { recursive: true })
  await fs.writeFile(join(root, rel), content)
}
const read = (root: string, rel: string) => fs.readFile(join(root, rel), 'utf8')

async function tree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(dir: string, prefix: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (rel === '.git' || rel === '.memon/index') continue
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else if (entry.isSymbolicLink()) out[rel] = `-> ${await fs.readlink(join(dir, entry.name))}`
      else out[rel] = await fs.readFile(join(dir, entry.name), 'utf8')
    }
  }
  await walk(root, '')
  return out
}

const runReadme = (id: string, status: string, extra = '') =>
  `---\nid: ${id}\nstatus: ${status}\ncreated_at: '2026-09-01T09:00:00+08:00'\nupdated_at: '2026-09-01T09:00:00+08:00'\n${extra}---\n`

function experimentReadme(id: string, runs: string[], pointer = LEGACY_RESULTS_POINTER) {
  return `---
id: ${id}
slug: ${id.slice(6)}
title: Demo
status: OPEN
archived: false
runs: [${runs.map((run) => `"${run}"`).join(', ')}]
hypotheses: []
tags: []
created_at: '2026-09-01T09:00:00+08:00'
updated_at: '2026-09-01T09:00:00+08:00'
---

## Motivation

## Design

## Implementation
> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.

## Investigation
> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.

## Results
${pointer}

## Findings

## Limitations

## Conclusion

## Warnings
`
}

const A = 'logs/a-260901-090000'
const B = 'logs/b-260901-100000'
const C = 'logs/c-260901-110000'
const D = 'logs/d-260901-120000'
const E = 'logs/e-260901-130000'
const GONE = 'logs/gone-260101-000000'
const EXP = 'docs/experiments/E0001-demo'

const RESULTS_YAML = `schema_version: 1
column_annotations:
  precision:
    description: Training precision.
    value_descriptions:
      bf16: bfloat16 autocast
custom_top: keep
columns:
  - {key: precision, label: Precision, group: parameter, type: enum, options: [fp32, bf16]}
  - {key: lr, label: LR, group: parameter, type: number}
  - {key: fid, label: FID, group: metric, type: number}
  - {key: clip, label: CLIP, group: metric, type: string}
  - {key: detail, label: Detail, group: metric, type: string}
  - {key: splits, label: Splits, group: metric, type: string}
  - {key: wandb, label: W&B, group: metric, type: string}
  - {key: notes, label: Notes, group: metric, type: string}
variants:
  - id: V0001
    name: single
    status: COMPLETED
    custom_variant_key: keep
    parameters: {precision: bf16, lr: 0.1}
    metrics:
      fid: 12.3
      clip: "0.31 ± 0.02"
      detail: '{"a": 1, "b": "x"}'
      splits: '["train","val"]'
      wandb: https://wandb.ai/acme/p/runs/abc
      notes: '{"k": [1, 2]}'
      extra_metric: 5
    runs: [${A}]
    attempts: []
    provenance: {repo: https://example.invalid/repo.git, commit: abc1234, entry: scripts/train.sh, host_note: x, env: {LR: 0.000008, MODE: fast}}
  - id: V0002
    name: seeds
    status: COMPLETED
    parameters: {precision: fp32, lr: 0.2}
    metrics: {fid: 11.0, clip: 0.30, detail: '{"a": 2, "b": "y"}', splits: '["train"]', notes: plain text}
    runs: [${B}, ${C}]
    attempts: []
  - id: V0003
    name: retry
    status: PLANNED
    metrics: {fid: 10.5, clip: '{"mean": 0.29, "sample_std": 0.01, "eligible_seeds": 3, "extra": 7}'}
    runs: [${E}]
    attempts: [${D}]
  - id: V0004
    name: historical
    status: COMPLETED
    metrics: {fid: 13.1}
    runs: [${GONE}]
    attempts: []
  - id: V0005
    name: blocked
    status: BLOCKED
    runs: []
    attempts: []
`

async function fixture(
  options: {
    git?: boolean
    gitignore?: string
    results?: string
    extraRuns?: Record<string, string>
    /** Declared Run → symlink target (relative to `logs/`, or absolute); the Run's files move there. */
    symlinks?: Record<string, string>
  } = {},
) {
  const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-v8-v9-')))
  roots.push(base)
  const root = join(base, 'project')
  const runs: Record<string, string> = {
    [A]: 'FINISHED',
    [B]: 'FINISHED',
    [C]: 'FINISHED',
    [D]: 'FAILED',
    [E]: 'FINISHED',
    ...(options.extraRuns ?? {}),
  }
  for (const [run, status] of Object.entries(runs)) {
    await write(root, `${run}/README.md`, runReadme(run.split('/').at(-1)!, status))
    await write(root, `${run}/train.log`, 'log\n')
  }
  await write(
    root,
    `${EXP}/README.md`,
    experimentReadme('E0001-demo', [...Object.keys(runs), GONE]),
  )
  await write(root, `${EXP}/implementation.yaml`, 'schema_version: 1\nitems: []\n')
  await write(
    root,
    `${EXP}/investigation.yaml`,
    'schema_version: 1\nitems:\n  - {id: INV0001, title: Compare, status: IN_PROGRESS, variant_ids: [V0001]}\n',
  )
  await write(root, `${EXP}/results.yaml`, options.results ?? RESULTS_YAML)
  await write(root, '.memon/version.json', MARKER_V8)
  for (const [run, target] of Object.entries(options.symlinks ?? {})) {
    const real = resolve(root, 'logs', target)
    await fs.mkdir(join(real, '..'), { recursive: true })
    await fs.rename(join(root, run), real)
    await fs.symlink(target, join(root, run))
  }
  if (options.gitignore !== undefined) await write(root, '.gitignore', options.gitignore)
  if (options.git) {
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.email', 'test@example.invalid')
    git(root, 'config', 'user.name', 'memon test')
    git(root, 'config', 'commit.gpgsign', 'false')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
  }
  return { root: await fs.realpath(root), backup: join(base, 'backup') }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

const file = (plan: ResultsMigrationPlan, path: string) =>
  plan.files.find((entry) => entry.path === path)

describe('value conversions', () => {
  it('converts a pure ± column to stats', () => {
    const cells = ['0.31 ± 0.02', '0.30 +/- 0.01', null, ''].map(classifyV8Cell)
    expect(columnConversion(cells)).toBe('stats')
    expect(convertedRows('metrics.clip', cells[0]!, 'stats')).toEqual({
      rows: [
        { path: 'metrics.clip', stat: 'mean', value: 0.31 },
        { path: 'metrics.clip', stat: 'std', value: 0.02 },
      ],
      conversions: ['PLUS_MINUS_TO_STATS'],
    })
    // Empty cells stay missing.
    expect(convertedRows('metrics.clip', cells[2]!, 'stats')).toEqual({ rows: [], conversions: [] })
    expect(convertedRows('metrics.clip', cells[3]!, 'stats')).toEqual({ rows: [], conversions: [] })
  })

  it('converts a column mixing ± strings and plain numbers to stats cell by cell', () => {
    // Plain numbers outnumber the ± strings; they still join the stats column as `mean`.
    const cells = [0.29, 0.28, 0.27, '0.31 ± 0.02'].map(classifyV8Cell)
    expect(columnConversion(cells)).toBe('stats')
    expect(convertedRows('metrics.clip', cells[0]!, 'stats')).toEqual({
      rows: [{ path: 'metrics.clip', stat: 'mean', value: 0.29 }],
      conversions: ['MIGRATED_NUMBER_AS_MEAN'],
    })
    // Numbers alone never become stats.
    expect(columnConversion([1, 2, 'n/a'].map(classifyV8Cell))).toBe('verbatim')
  })

  it('keeps only the unparseable cell of a stats column verbatim', () => {
    const cells = ['0.31 ± 0.02', '0.648 ± —', 0.3, 'n/a', null].map(classifyV8Cell)
    expect(columnConversion(cells)).toBe('stats')
    expect(convertedRows('metrics.clip', cells[1]!, 'stats')).toEqual({
      rows: [{ path: 'metrics.clip', stat: null, value: '0.648 ± —' }],
      conversions: ['RESULT_CELL_NOT_CONVERTED'],
    })
    expect(convertedRows('metrics.clip', cells[3]!, 'stats').conversions).toEqual([
      'RESULT_CELL_NOT_CONVERTED',
    ])
    // The majority convertible shape wins; a group needs every cell.
    expect(columnConversion(['[1]', '[2]', '1 ± 2'].map(classifyV8Cell))).toBe('list')
    expect(columnConversion(['{"a": 1}', 'x'].map(classifyV8Cell))).toBe('verbatim')
    expect(columnConversion(['{"a": 1}', '{"a": 2}'].map(classifyV8Cell))).toBe('group')
    const json = classifyV8Cell('{"median": 3, "count": 4, "note": "x"}')
    expect(convertedRows('metrics.lat', json, 'stats')).toEqual({
      rows: [
        { path: 'metrics.lat', stat: 'p50', value: 3 },
        { path: 'metrics.lat', stat: 'n', value: 4 },
        { path: 'metrics.lat_note', stat: null, value: 'x' },
      ],
      conversions: ['JSON_TO_STATS'],
    })
    expect(classifyV8Cell('https://wandb.ai/acme/p/runs/abc')).toMatchObject({ kind: 'scalar' })
    expect(classifyV8Cell('{"nested": {"a": 1}}')).toMatchObject({ kind: 'json-string' })
  })
})

describe('planResultsMigration', () => {
  it('maps every results.yaml row of the design table without writing', async () => {
    const { root } = await fixture()
    const before = await tree(root)
    const plan = await planResultsMigration(root)
    expect(await tree(root)).toEqual(before)
    expect(plan.unresolved).toEqual([])
    expect(plan.blockers).toEqual([])
    const description = JSON.parse(file(plan, `${EXP}/experiment.json`)!.after!)
    expect(description.experiment_schema_version).toBe(1)
    expect(description.custom_top).toBe('keep')
    expect(description.groups).toEqual({ 'metrics.detail': { label: 'Detail' } })
    expect(description.columns).toEqual([
      {
        path: 'params.precision',
        label: 'Precision',
        type: 'enum',
        options: ['fp32', 'bf16'],
        description: 'Training precision.',
        value_descriptions: { bf16: 'bfloat16 autocast' },
      },
      { path: 'params.lr', label: 'LR', type: 'number' },
      { path: 'metrics.fid', label: 'FID', type: 'number' },
      { path: 'metrics.clip', label: 'CLIP', type: 'stats' },
      { path: 'metrics.splits', label: 'Splits', type: 'list' },
      { path: 'metrics.wandb', label: 'W&B', type: 'string' },
      { path: 'metrics.notes', label: 'Notes', type: 'string' },
      { path: 'env.LR', label: 'LR', type: 'string' },
      { path: 'env.MODE', label: 'MODE', type: 'string' },
    ])
    const [v1, v2, v3, v4, v5] = description.variants
    expect(v1).toEqual({
      id: 'V0001',
      name: 'single',
      values: {
        'params.precision': 'bf16',
        'params.lr': 0.1,
        'env.LR': '0.000008',
        'env.MODE': 'fast',
      },
      provenance: {
        repo: 'https://example.invalid/repo.git',
        commit: 'abc1234',
        entry: 'scripts/train.sh',
        host_note: 'x',
      },
      runs: [A],
      custom_variant_key: 'keep',
    })
    expect(v2.runs).toEqual([B, C])
    expect(v2.frozen).toMatchObject({
      status: 'COMPLETED',
      runs: [B, C],
      source: expect.stringMatching(/^results\.yaml@[0-9a-f]{40}$/),
      values: [
        { path: 'metrics.fid', stat: null, value: 11 },
        { path: 'metrics.clip', stat: 'mean', value: 0.3 },
        { path: 'metrics.detail.a', stat: null, value: 2 },
        { path: 'metrics.detail.b', stat: null, value: 'y' },
        { path: 'metrics.splits', stat: null, value: ['train'] },
        { path: 'metrics.notes', stat: null, value: 'plain text' },
      ],
    })
    expect(v3).toMatchObject({ status: 'PLANNED', runs: [E, D] })
    expect(v3.frozen).toBeUndefined()
    expect(v4.frozen).toMatchObject({
      status: 'COMPLETED',
      runs: [GONE],
      values: [{ path: 'metrics.fid', value: 13.1 }],
    })
    expect(v5).toEqual({ id: 'V0005', name: 'blocked', status: 'BLOCKED', runs: [] })
    expect(file(plan, `${A}/result.csv`)!.after).toBe(
      [
        'path,stat,value',
        '$experiment_schema_version,,1',
        'metrics.fid,,12.3',
        'metrics.clip,mean,0.31',
        'metrics.clip,std,0.02',
        'metrics.detail.a,,1',
        'metrics.detail.b,,x',
        'metrics.splits,,"[""train"",""val""]"',
        'metrics.wandb,,https://wandb.ai/acme/p/runs/abc',
        'metrics.notes,,"{""k"": [1, 2]}"',
        'metrics.extra_metric,,5',
        '',
      ].join('\n'),
    )
    expect(file(plan, `${E}/result.csv`)!.after).toBe(
      [
        'path,stat,value',
        '$experiment_schema_version,,1',
        'metrics.fid,,10.5',
        'metrics.clip,mean,0.29',
        'metrics.clip,std,0.01',
        'metrics.clip,n,3',
        'metrics.clip_extra,,7',
        '',
      ].join('\n'),
    )
    expect(file(plan, `${B}/result.csv`)).toBeUndefined()
    expect(file(plan, `${EXP}/README.md`)!.after).toContain(MANAGED_SECTION_POINTERS.results)
    expect(file(plan, `${EXP}/results.yaml`)!.action).toBe('delete')
    expect(plan.counts).toMatchObject({
      PLUS_MINUS_TO_STATS: 1,
      JSON_TO_STATS: 1,
      MIGRATED_NUMBER_AS_MEAN: 1,
      JSON_TO_GROUP: 2,
      JSON_TO_LIST: 2,
      RESULT_JSON_STRING: 1,
      envCoerced: 1,
      undeclaredKeys: 1,
      variants: 5,
    })
    expect(plan.notices.map((notice) => notice.code)).toEqual(
      expect.arrayContaining([
        'RESULTS_ENV_VALUE_COERCED',
        'RESULT_JSON_STRING',
        'VARIANT_STATUS_CHANGED',
      ]),
    )
    // V0004 lists a missing Run directory: its status now derives as INCONCLUSIVE.
    expect(
      plan.notices
        .filter((notice) => notice.code === 'VARIANT_STATUS_CHANGED')
        .map((notice) => notice.variant),
    ).toEqual(['V0003', 'V0004'])
    expect(plan.expected.summaryDifferences).toEqual([])
  })

  it('reports every blocker and applies reviewed resolutions', async () => {
    const results = `schema_version: 1
columns: [{key: fid, label: FID, group: metric, type: number}]
variants:
  - {id: V0001, name: a, status: COMPLETED, metrics: {fid: 1}, runs: [${A}], attempts: [${E}]}
  - {id: V0002, name: b, status: COMPLETED, metrics: {fid: 2}, runs: [${B}, ${A}], attempts: []}
  - {id: V0003, name: c, status: COMPLETED, metrics: {fid: 3}, runs: [logs/x-260901-140000], attempts: []}
`
    const { root } = await fixture({ results })
    await write(
      root,
      `${B}/result.csv`,
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.own,,1\n',
    )
    await write(
      root,
      `${B}/sidecar.json`,
      '{"variant_id": "V0003", "role": "baseline", "baseline": {"metrics": {"fid": 2}}}',
    )
    await write(
      root,
      'docs/experiments/E0002-broken/README.md',
      experimentReadme('E0002-broken', []),
    )
    await write(root, 'docs/experiments/E0002-broken/results.yaml', 'variants: [\n')
    const plan = await planResultsMigration(root, { sidecarName: 'sidecar.json' })
    expect(
      plan.blockers.map((blocker) => [
        blocker.code,
        blocker.run ?? blocker.experiment,
        blocker.choices,
      ]),
    ).toEqual([
      ['RUN_IN_TWO_VARIANTS', A, ['V0001', 'V0002']],
      ['VARIANT_RUN_NOT_MEMBER', 'logs/x-260901-140000', ['link', 'drop']],
      ['SIDECAR_VARIANT_CONFLICT', B, ['V0002', 'V0003']],
      ['RESULT_FILE_EXISTS', B, ['keep', 'replace']],
      ['RESULTS_YAML_UNREADABLE', 'E0002-broken', []],
    ])
    await expect(applyResultsMigration(plan, join(root, '..', 'b1'))).rejects.toThrow(
      /unresolved blockers/,
    )
    await fs.rm(join(root, 'docs/experiments/E0002-broken'), { recursive: true })
    const resolved = await planResultsMigration(root, {
      sidecarName: 'sidecar.json',
      resolutions: {
        [`RUN_IN_TWO_VARIANTS:E0001-demo:${A}`]: 'V0001',
        'VARIANT_RUN_NOT_MEMBER:E0001-demo:logs/x-260901-140000': 'link',
        [`FINISHED_ATTEMPT:E0001-demo:${E}`]: 'deprecate',
        [`SIDECAR_VARIANT_CONFLICT:E0001-demo:${B}`]: 'V0002',
        [`RESULT_FILE_EXISTS:E0001-demo:${B}`]: 'replace',
      },
    })
    expect(plan.unresolved.length).toBeGreaterThan(0)
    expect(resolved.unresolved).toEqual([])
    const description = JSON.parse(file(resolved, `${EXP}/experiment.json`)!.after!)
    expect(description.variants.map((variant: { runs: string[] }) => variant.runs)).toEqual([
      [A, E],
      [B],
      ['logs/x-260901-140000'],
    ])
    expect(file(resolved, `${E}/README.md`)!.after).toContain('deprecated: true')
    expect(file(resolved, `${EXP}/README.md`)!.after).toContain('logs/x-260901-140000')
    expect(file(resolved, `${B}/result.csv`)).toMatchObject({ action: 'replace' })
  })

  it('plans the allow rules for ignored result files (git) without blockers', async () => {
    const ignoredFiles = await fixture({ git: true, gitignore: 'logs/*/*\n!logs/*/README.md\n' })
    const plan = await planResultsMigration(ignoredFiles.root)
    expect(plan.blockers).toEqual([])
    expect(plan.allowRules).toMatchObject([
      {
        file: '.gitignore',
        lines: [RESULT_ALLOW_RULES_COMMENT, '!/logs/*/result.csv'],
        overrides: ['.gitignore:1:logs/*/*'],
      },
    ])
    expect(file(plan, '.gitignore')).toMatchObject({
      action: 'append',
      after: `logs/*/*\n!logs/*/README.md\n${RESULT_ALLOW_RULES_COMMENT}\n!/logs/*/result.csv\n`,
    })
    const excluded = await fixture({ git: true, gitignore: 'logs/\n' })
    const ladder = await planResultsMigration(excluded.root)
    expect(ladder.blockers).toEqual([])
    expect(ladder.allowRules[0]!.lines).toEqual([
      RESULT_ALLOW_RULES_COMMENT,
      '!/logs/',
      '/logs/*',
      '!/logs/*/',
      '/logs/*/*',
      '!/logs/*/result.csv',
    ])
  })

  it('resolves a symlinked Run to its real path inside the project', async () => {
    const real = 'logs/a-20260901-090000'
    const { root, backup } = await fixture({
      git: true,
      gitignore: 'logs/*/*\n!logs/*/README.md\n',
      symlinks: { [A]: 'a-20260901-090000' },
    })
    const before = await tree(root)
    const plan = await planResultsMigration(root)
    expect(plan.blockers).toEqual([])
    expect(plan.counts.symlinkedRuns).toBe(1)
    expect(file(plan, `${real}/result.csv`)).toMatchObject({ action: 'create' })
    expect(file(plan, `${A}/result.csv`)).toBeUndefined()
    expect(plan.allowRules[0]!.lines).toEqual([RESULT_ALLOW_RULES_COMMENT, '!/logs/*/result.csv'])
    const result = await applyResultsMigration(plan, backup)
    expect(result.status).toBe('migrated')
    expect(git(root, 'ls-files', `${real}/result.csv`)).toBe(`${real}/result.csv`)
    expect(git(root, 'status', '--porcelain')).toBe('')
    expect(await verifyResultsMigration(root)).toMatchObject({ ok: true, marker: 9 })
    const summary = (await loadResultsSummary(root, 'E0001-demo'))!.summary
    expect(summary.variants[0]!.cells['metrics.fid']).toMatchObject({ value: 12.3 })
    expect((await rollbackResultsMigration(backup)).marker).toBe('reverted')
    expect(await tree(root)).toEqual(before)
  })

  it('blocks a symlinked Run whose target leaves the project', async () => {
    const { root } = await fixture({
      git: true,
      symlinks: { [A]: '../../elsewhere-260901-090000' },
    })
    const plan = await planResultsMigration(root)
    expect(plan.blockers.map((blocker) => [blocker.code, blocker.run, blocker.choices])).toEqual([
      ['RUN_PATH_OUTSIDE_PROJECT', A, []],
    ])
    expect(plan.unresolved).toEqual([`RUN_PATH_OUTSIDE_PROJECT:E0001-demo:${A}`])
    expect(plan.files.some((entry) => entry.path.startsWith('..'))).toBe(false)
  })

  it('blocks a deprecation that would edit a git-ignored Run README', async () => {
    const results = `schema_version: 1
columns: [{key: fid, label: FID, group: metric, type: number}]
variants:
  - {id: V0001, name: a, status: COMPLETED, metrics: {fid: 1}, runs: [${A}], attempts: [${E}]}
`
    const { root } = await fixture({ git: true, results, gitignore: `/${E}/README.md\n` })
    const choice = { [`FINISHED_ATTEMPT:E0001-demo:${E}`]: 'deprecate' }
    const plan = await planResultsMigration(root, { resolutions: choice })
    expect(plan.unresolved).toEqual([`RUN_README_IGNORED:E0001-demo:${E}`])
    expect(plan.blockers.find((blocker) => blocker.code === 'RUN_README_IGNORED')).toMatchObject({
      run: E,
      choices: [],
    })
    const adopted = await planResultsMigration(root, {
      resolutions: { [`FINISHED_ATTEMPT:E0001-demo:${E}`]: 'adopt' },
    })
    expect(adopted.unresolved).toEqual([])
  })

  it('keeps a FINISHED attempt as Variant history by default (no blocker)', async () => {
    const results = `schema_version: 1
columns: [{key: fid, label: FID, group: metric, type: number}]
variants:
  - {id: V0001, name: a, status: COMPLETED, metrics: {fid: 1}, runs: [${A}], attempts: [${E}, ${D}]}
  - {id: V0002, name: b, status: COMPLETED, metrics: {fid: 2}, runs: [], attempts: [${C}]}
`
    const { root } = await fixture({ results })
    const plan = await planResultsMigration(root)
    expect(plan.blockers).toEqual([])
    expect(plan.counts.finishedAttemptsKept).toBe(2)
    expect(
      plan.notices
        .filter((notice) => notice.code === 'FINISHED_ATTEMPT_KEPT_AS_HISTORY')
        .map((notice) => [notice.variant, notice.run]),
    ).toEqual([
      ['V0001', E],
      ['V0002', C],
    ])
    const description = JSON.parse(file(plan, `${EXP}/experiment.json`)!.after!)
    const [v1, v2] = description.variants
    // The FAILED attempt stays a member (never evidence); the FINISHED one is history.
    expect(v1.runs).toEqual([A, D])
    expect(v1.frozen).toMatchObject({ runs: [A], values: [], attempts: [E] })
    expect(file(plan, `${A}/result.csv`)!.after).toContain('metrics.fid,,1')
    // A Variant left without members keeps its v8 values and status frozen.
    expect(v2.runs).toEqual([])
    expect(v2.frozen).toMatchObject({
      status: 'COMPLETED',
      runs: [],
      values: [{ path: 'metrics.fid', stat: null, value: 2 }],
      attempts: [C],
    })
    expect(file(plan, `${E}/README.md`)).toBeUndefined()
    expect(plan.expected.summaryDifferences).toEqual([])
    // A resolution may still adopt it.
    const adopted = await planResultsMigration(root, {
      resolutions: { [`FINISHED_ATTEMPT:E0001-demo:${E}`]: 'adopt' },
    })
    const adoptedDescription = JSON.parse(file(adopted, `${EXP}/experiment.json`)!.after!)
    expect(adoptedDescription.variants[0].runs).toEqual([A, E, D])
    expect(adopted.counts.finishedAttemptsKept).toBe(1)
  })

  it('re-plans identically', async () => {
    const { root } = await fixture()
    const first = await planResultsMigration(root)
    const second = await planResultsMigration(root)
    expect(second).toEqual(first)
  })
})

describe('applyResultsMigration', () => {
  it('converts ± cell by cell, renames foreign result files and rolls back (git)', async () => {
    const results = `schema_version: 1
columns: [{key: fid, label: FID, group: metric, type: string}]
variants:
  - {id: V0001, name: a, status: COMPLETED, metrics: {fid: "1.5 ± 0.1"}, runs: [${A}], attempts: [${E}]}
  - {id: V0002, name: b, status: COMPLETED, metrics: {fid: 2}, runs: [${B}, ${D}], attempts: []}
  - {id: V0003, name: c, status: COMPLETED, metrics: {fid: "3 ± —"}, runs: [${C}], attempts: []}
`
    const gitignore = 'logs/*/*\n!logs/*/README.md\n'
    const { root, backup } = await fixture({ git: true, gitignore, results })
    // Foreign result tables (ignored, untracked) and an existing legacy name.
    await write(root, `${A}/result.csv`, 'step,loss\n1,0.5\n')
    await write(root, `${A}/result.legacy.csv`, 'older\n')
    await write(root, `${B}/result.csv`, 'metric,value\nfid,2\n')
    const before = await tree(root)
    const plan = await planResultsMigration(root)
    expect(plan.blockers).toEqual([])
    expect(plan.unresolved).toEqual([])
    expect(plan.legacyRenames).toEqual([
      {
        experiment: 'E0001-demo',
        run: A,
        from: `${A}/result.csv`,
        to: `${A}/result.legacy.2.csv`,
      },
      { experiment: 'E0001-demo', run: B, from: `${B}/result.csv`, to: `${B}/result.legacy.csv` },
    ])
    expect(plan.counts).toMatchObject({
      PLUS_MINUS_TO_STATS: 1,
      MIGRATED_NUMBER_AS_MEAN: 1,
      RESULT_CELL_NOT_CONVERTED: 1,
      statsColumns: 1,
      finishedAttemptsKept: 1,
      legacyResultFilesRenamed: 2,
    })
    expect(
      plan.notices.find((notice) => notice.code === 'RESULT_CELL_NOT_CONVERTED'),
    ).toMatchObject({ variant: 'V0003', path: 'metrics.fid' })
    const description = JSON.parse(file(plan, `${EXP}/experiment.json`)!.after!)
    expect(description.columns).toEqual([{ path: 'metrics.fid', label: 'FID', type: 'stats' }])
    expect(file(plan, `${A}/result.csv`)).toMatchObject({ action: 'replace' })
    expect(file(plan, `${A}/result.csv`)!.after).toContain(
      'metrics.fid,mean,1.5\nmetrics.fid,std,0.1\n',
    )
    expect(file(plan, `${A}/result.legacy.2.csv`)).toMatchObject({
      action: 'create',
      after: 'step,loss\n1,0.5\n',
    })
    // B has no attributable rows (two Runs): its foreign file is moved away.
    expect(file(plan, `${B}/result.csv`)).toMatchObject({ action: 'delete' })
    expect(file(plan, `${C}/result.csv`)!.after).toContain('metrics.fid,,3 ± —')
    // Only the unconvertible cell is a (predicted) lint error.
    expect(Object.values(plan.expected.lint).flat().join('\n')).toContain(`${C}/result.csv`)

    const result = await applyResultsMigration(plan, backup)
    expect(result.status).toBe('migrated')
    expect(git(root, 'status', '--porcelain')).toBe('')
    // The renamed files are committed although the ignore rules cover them.
    expect(git(root, 'ls-files', `${A}`, `${B}`).split('\n').sort()).toEqual([
      `${A}/README.md`,
      `${A}/result.csv`,
      `${A}/result.legacy.2.csv`,
      `${B}/README.md`,
      `${B}/result.legacy.csv`,
    ])
    expect(await read(root, `${B}/result.legacy.csv`)).toBe('metric,value\nfid,2\n')
    await expect(fs.access(join(root, B, 'result.csv'))).rejects.toThrow()
    expect(await verifyResultsMigration(root)).toMatchObject({ ok: true, marker: 9 })
    const summary = (await loadResultsSummary(root, 'E0001-demo'))!.summary
    expect(summary.variants[0]!.cells['metrics.fid']).toMatchObject({
      kind: 'stats',
      values: { mean: 1.5, std: 0.1 },
    })
    expect((await rollbackResultsMigration(backup)).marker).toBe('reverted')
    expect(await tree(root)).toEqual(before)
  })

  it('migrates, verifies and commits in git mode; rollback reverts byte for byte', async () => {
    const gitignore = 'logs/*/*\n!logs/*/README.md\n'
    const { root, backup } = await fixture({ git: true, gitignore })
    const before = await tree(root)
    const plan = await planResultsMigration(root)
    const result = await applyResultsMigration(plan, backup)
    expect(result.status).toBe('migrated')
    expect(git(root, 'log', '-1', '--format=%s')).toBe(V8_TO_V9_COMMIT_MESSAGE)
    expect(git(root, 'status', '--porcelain')).toBe('')
    expect(JSON.parse(await read(root, '.memon/version.json')).fs_convention_version).toBe(9)
    await expect(fs.access(join(root, EXP, 'results.yaml'))).rejects.toThrow()
    expect(git(root, 'ls-files', `${A}/result.csv`, `${EXP}/experiment.json`, '.gitignore')).toBe(
      `.gitignore\n${EXP}/experiment.json\n${A}/result.csv`,
    )
    expect(await verifyResultsMigration(root)).toMatchObject({ ok: true, marker: 9 })
    const summary = (await loadResultsSummary(root, 'E0001-demo'))!.summary
    expect(summary.outcome).toBe('ok')
    expect(summary.variants.map((variant) => [variant.id, variant.status])).toEqual([
      ['V0001', 'COMPLETED'],
      ['V0002', 'COMPLETED'],
      ['V0003', 'COMPLETED'],
      ['V0004', 'INCONCLUSIVE'],
      ['V0005', 'BLOCKED'],
    ])
    expect(summary.variants[1]!.cells['metrics.fid']).toMatchObject({ source: 'frozen', value: 11 })

    // A second apply is a no-op apart from refreshing the index.
    const again = await planResultsMigration(root)
    expect(again.alreadyMigrated).toBe(true)
    const migratedTree = await tree(root)
    expect((await applyResultsMigration(again, null)).status).toBe('refreshed')
    expect(await tree(root)).toEqual(migratedTree)

    const rolled = await rollbackResultsMigration(backup)
    expect(rolled.marker).toBe('reverted')
    expect(await tree(root)).toEqual(before)
    expect(await read(root, '.gitignore')).toBe(gitignore)
  })

  it('restores every file and the marker without Git', async () => {
    const { root, backup } = await fixture()
    const before = await tree(root)
    const plan = await planResultsMigration(root)
    const result = await applyResultsMigration(plan, backup)
    expect(result).toMatchObject({ status: 'migrated', commit: null })
    expect(await verifyResultsMigration(root)).toMatchObject({ ok: true })
    expect(await rollbackResultsMigration(backup)).toEqual({
      marker: 'restored',
      revertCommit: null,
    })
    expect(await tree(root)).toEqual(before)
  })

  it('leaves marker 8, commits nothing and restores every file when the ignore check fails', async () => {
    const { root, backup } = await fixture({
      git: true,
      gitignore: 'logs/*/*\n!logs/*/README.md\n',
    })
    const before = await tree(root)
    const head = git(root, 'rev-parse', 'HEAD')
    const plan = await planResultsMigration(root)
    // An incomplete plan: the allow rules are not appended.
    plan.files = plan.files.filter((entry) => entry.path !== '.gitignore')
    await expect(applyResultsMigration(plan, backup)).rejects.toThrow(/still ignored by Git/)
    expect(JSON.parse(await read(root, '.memon/version.json')).fs_convention_version).toBe(8)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
    expect(await tree(root)).toEqual(before)
  })

  it('refuses a stale plan', async () => {
    const { root, backup } = await fixture()
    const plan = await planResultsMigration(root)
    await write(root, `${EXP}/results.yaml`, `${RESULTS_YAML}# edited\n`)
    await expect(applyResultsMigration(plan, backup)).rejects.toThrow(/Stale migration plan/)
  })
})

// ---------- scratch copies of the mock projects ----------

const MOCK = resolve(__dirname, '../../../../mock')

/** Turn a copy of a mock project into an FS v8 project with results.yaml bundles. */
async function v8MockCopy(
  name: 'project-a' | 'project-b',
  options: { git?: boolean; gitignore?: string },
) {
  const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-v8-v9-mock-')))
  roots.push(base)
  const root = join(base, name)
  await fs.cp(join(MOCK, name), root, { recursive: true })
  await fs.rm(join(root, '.memon'), { recursive: true, force: true })
  await write(root, '.memon/version.json', MARKER_V8)
  const experiments = (await fs.readdir(join(root, 'docs/experiments'))).sort()
  for (const id of experiments) {
    const readmePath = `docs/experiments/${id}/README.md`
    const readme = await read(root, readmePath)
    const runs = /^runs: (\[.*\])$/m.exec(readme)?.[1]
    const members = runs ? (JSON.parse(runs) as string[]) : []
    await write(root, readmePath, `${readme.trimEnd()}\n\n## Results\n${LEGACY_RESULTS_POINTER}\n`)
    await write(
      root,
      `docs/experiments/${id}/implementation.yaml`,
      'schema_version: 1\nitems: []\n',
    )
    await write(root, `docs/experiments/${id}/investigation.yaml`, 'schema_version: 1\nitems: []\n')
    const variants = members.map(
      (run, index) => `  - id: V${String(index + 1).padStart(4, '0')}
    name: ${run.split('/').at(-1)}
    status: ${index === 0 ? 'COMPLETED' : 'RUNNING'}
    parameters: {seed: ${index}}
    metrics: {fid: ${10 + index}.5, clip: "0.3${index} ± 0.0${index + 1}"}
    runs: [${run}]
    attempts: []`,
    )
    if (members.length > 1)
      variants.push(`  - id: V${String(members.length + 1).padStart(4, '0')}
    name: pooled
    status: COMPLETED
    metrics: {fid: 11.0}
    runs: []
    attempts: []`)
    await write(
      root,
      `docs/experiments/${id}/results.yaml`,
      `schema_version: 1\ncolumns:\n  - {key: seed, label: Seed, group: parameter, type: number}\n  - {key: fid, label: FID, group: metric, type: number}\n  - {key: clip, label: CLIP, group: metric, type: string}\nvariants:\n${variants.join('\n')}\n`,
    )
  }
  if (options.gitignore !== undefined) await write(root, '.gitignore', options.gitignore)
  if (options.git) {
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.email', 'test@example.invalid')
    git(root, 'config', 'user.name', 'memon test')
    git(root, 'config', 'commit.gpgsign', 'false')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'v8 fixture')
  }
  return { root: await fs.realpath(root), backup: join(base, 'backup') }
}

describe('mock project copies', () => {
  for (const name of ['project-a', 'project-b'] as const) {
    for (const mode of ['git', 'non-git'] as const) {
      it(`${name} (${mode}): plan, apply, verify and roll back`, async () => {
        const { root, backup } = await v8MockCopy(name, {
          git: mode === 'git',
          ...(mode === 'git' ? { gitignore: 'logs/*/*\n!logs/*/README.md\n' } : {}),
        })
        const before = await tree(root)
        const plan = await planResultsMigration(root)
        expect(plan.unresolved).toEqual([])
        expect(plan.expected.summaryDifferences).toEqual([])
        const applied = await applyResultsMigration(plan, backup)
        expect(applied.status).toBe('migrated')
        const verified = await verifyResultsMigration(root)
        expect(verified.problems).toEqual([])
        expect(verified.ok).toBe(true)
        const rolled = await rollbackResultsMigration(backup)
        expect(rolled.marker).toBe(mode === 'git' ? 'reverted' : 'restored')
        expect(await tree(root)).toEqual(before)
      })
    }
  }
})
