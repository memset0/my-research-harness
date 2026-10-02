import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applySchemaUpgrade,
  applyUpgradeOperations,
  planSchemaUpgrade,
  scaleResultStatistic,
  type UpgradeRow,
} from './schema-upgrade.js'
import { loadResultsSummary } from './summary-cache.js'

let root: string
const A = 'logs/a-260901-090000'
const B = 'logs/b-260901-090000'
const EXP = 'docs/experiments/E0001-foo'

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-schema-upgrade-')))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function write(rel: string, content: string) {
  await fs.mkdir(join(root, rel, '..'), { recursive: true })
  await fs.writeFile(join(root, rel), content)
}
const read = (rel: string) => fs.readFile(join(root, rel), 'utf8')

const csv = (version: number, rows: string[]) =>
  `path,stat,value\n$experiment_schema_version,,${version}\n${rows.map((row) => `${row}\n`).join('')}`

async function tree(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(dir: string, prefix: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (rel === '.memon') continue
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else out[rel] = await fs.readFile(join(dir, entry.name), 'utf8')
    }
  }
  await walk(root, '')
  return out
}

async function project(options: { descriptionVersion?: number; status?: string } = {}) {
  await write(
    `${EXP}/README.md`,
    `---\nid: E0001-foo\nslug: foo\ntitle: T\nstatus: OPEN\nruns: ["${A}", "${B}"]\n---\n`,
  )
  await write(
    `${EXP}/experiment.json`,
    `${JSON.stringify(
      {
        experiment_schema_version: options.descriptionVersion ?? 1,
        groups: { 'params.lr_group': { label: 'LR' } },
        columns: [
          { path: 'metrics.fid', label: 'FID', type: 'number' },
          { path: 'metrics.serve.latency', label: 'Latency', type: 'stats', unit: 's' },
          { path: 'params.lr_group.lr', label: 'LR', type: 'number' },
        ],
        variants: [
          { id: 'V0001', name: 'x', values: { 'params.lr_group.lr': 0.1 }, runs: [A, B] },
          {
            id: 'V0002',
            name: 'old',
            runs: [],
            frozen: {
              status: 'COMPLETED',
              runs: ['logs/gone-260101-000000'],
              source: 'results.yaml@abc',
              values: [{ path: 'metrics.fid', stat: null, value: 13 }],
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  for (const run of [A, B])
    await write(`${run}/README.md`, `---\nstatus: ${options.status ?? 'FINISHED'}\n---\n`)
  await write(
    `${A}/result.csv`,
    csv(1, [
      'metrics.fid,,12',
      'metrics.debug,,1',
      'metrics.serve.latency,mean,0.1',
      'metrics.serve.latency,std,0.01',
      'metrics.serve.latency,n,10',
      'params.lr_group.lr,,0.1',
    ]),
  )
  await write(`${B}/result.csv`, csv(1, ['metrics.fid,,11', 'metrics.serve.latency,mean,0.2']))
  await write(
    `${EXP}/schema-upgrades/1-to-2.json`,
    `${JSON.stringify({
      from: 1,
      to: 2,
      operations: [
        { op: 'rename', from: 'metrics.fid', to: 'metrics.eval.fid' },
        { op: 'move', from: 'params.lr_group', to: 'params.optim' },
        { op: 'scale', path: 'metrics.serve.latency', factor: 1000, offset: 0, unit: 'ms' },
        { op: 'delete', path: 'metrics.debug' },
        { op: 'default', path: 'params.precision', value: 'bf16' },
      ],
    })}\n`,
  )
}

const rows = (...items: Array<[string, string, string]>): UpgradeRow[] =>
  items.map(([path, stat, value], origin) => ({ path, stat, value, origin }))

describe('declarative operations', () => {
  it('renames, moves, scales, deletes and fills defaults', () => {
    const result = applyUpgradeOperations(
      rows(
        ['metrics.fid', '', '12'],
        ['params.lr_group.lr', '', '0.1'],
        ['metrics.lat', 'mean', '0.5'],
        ['metrics.lat', 'std', '0.1'],
        ['metrics.lat', 'var', '0.01'],
        ['metrics.lat', 'n', '4'],
        ['metrics.debug.x', '', '1'],
      ),
      [
        { op: 'rename', from: 'metrics.fid', to: 'metrics.eval.fid' },
        { op: 'move', from: 'params.lr_group', to: 'params.optim' },
        { op: 'scale', path: 'metrics.lat', factor: 1000 },
        { op: 'delete', path: 'metrics.debug' },
        { op: 'default', path: 'params.precision', value: 'bf16' },
        { op: 'default', path: 'metrics.eval.fid', value: 99 },
      ],
      'f',
    )
    expect(result.rows.map((row) => [row.path, row.stat, row.value, row.origin])).toEqual([
      ['metrics.eval.fid', '', '12', 0],
      ['params.optim.lr', '', '0.1', 1],
      ['metrics.lat', 'mean', '500', 2],
      ['metrics.lat', 'std', '100', 3],
      ['metrics.lat', 'var', '10000', 4],
      ['metrics.lat', 'n', '4', 5],
      ['params.precision', '', 'bf16', null],
    ])
  })

  it('scales statistics by their class, with offsets only where exact', () => {
    expect(scaleResultStatistic('', 10, 1.8, 32)).toBe(50)
    expect(scaleResultStatistic('mean', 10, 1.8, 32)).toBe(50)
    expect(scaleResultStatistic('std', 10, 1.8, 32)).toBe(18)
    expect(scaleResultStatistic('var', 10, 2, 32)).toBe(40)
    expect(scaleResultStatistic('n', 10, 2, 32)).toBe(10)
    expect(scaleResultStatistic('sum', 10, 2, 0)).toBe(20)
    expect(scaleResultStatistic('sum', 10, 2, 1, 4)).toBe(24)
    expect(scaleResultStatistic('sum', 10, 2, 1)).toBeNull()
    expect(scaleResultStatistic('max.p99', 0.14, 1000, 0)).toBe(140)
    expect(scaleResultStatistic('std.mean', 1, 2, 5)).toBe(2)
  })
})

describe('planSchemaUpgrade', () => {
  it('previews every changed file with row differences and writes nothing', async () => {
    await project()
    const before = await tree()
    const plan = await planSchemaUpgrade(root, 'E0001-foo', 2)
    expect(await tree()).toEqual(before)
    expect(plan.steps).toEqual([
      { from: 1, to: 2, kind: 'json', file: `${EXP}/schema-upgrades/1-to-2.json` },
    ])
    expect(plan.files.map((file) => [file.path, file.kind, file.from, file.changed])).toEqual([
      [`${EXP}/experiment.json`, 'description', 1, true],
      [`${A}/result.csv`, 'result', 1, true],
      [`${B}/result.csv`, 'result', 1, true],
    ])
    const a = plan.files[1]!
    expect(a.rows).toEqual([
      {
        change: 'changed',
        path: 'metrics.eval.fid',
        stat: null,
        before: 'metrics.fid=12',
        after: 'metrics.eval.fid=12',
      },
      {
        change: 'changed',
        path: 'metrics.serve.latency',
        stat: 'mean',
        before: 'metrics.serve.latency:mean=0.1',
        after: 'metrics.serve.latency:mean=100',
      },
      {
        change: 'changed',
        path: 'metrics.serve.latency',
        stat: 'std',
        before: 'metrics.serve.latency:std=0.01',
        after: 'metrics.serve.latency:std=10',
      },
      {
        change: 'changed',
        path: 'params.optim.lr',
        stat: null,
        before: 'params.lr_group.lr=0.1',
        after: 'params.optim.lr=0.1',
      },
      { change: 'added', path: 'params.precision', stat: null, after: 'bf16' },
      { change: 'removed', path: 'metrics.debug', stat: null, before: '1' },
    ])
    expect(a.after).toBe(
      csv(2, [
        'metrics.eval.fid,,12',
        'metrics.serve.latency,mean,100',
        'metrics.serve.latency,std,10',
        'metrics.serve.latency,n,10',
        'params.optim.lr,,0.1',
        'params.precision,,bf16',
      ]),
    )
    const description = JSON.parse(plan.files[0]!.after)
    expect(description.experiment_schema_version).toBe(2)
    expect(description.groups).toEqual({ 'params.optim': { label: 'LR' } })
    expect(
      description.columns.map((column: { path: string; unit?: string }) => [
        column.path,
        column.unit,
      ]),
    ).toEqual([
      ['metrics.eval.fid', undefined],
      ['metrics.serve.latency', 'ms'],
      ['params.optim.lr', undefined],
    ])
    expect(description.variants[0].values).toEqual({ 'params.optim.lr': 0.1 })
    expect(description.variants[1].frozen.values).toEqual([
      { path: 'metrics.eval.fid', stat: null, value: 13 },
      { path: 'params.precision', stat: null, value: 'bf16' },
    ])
  })

  it('fails with BAD_REQUEST naming a missing step and changes nothing', async () => {
    await project()
    await fs.rm(join(root, EXP, 'schema-upgrades/1-to-2.json'))
    await write(`${EXP}/schema-upgrades/2-to-3.json`, '{"from": 2, "to": 3, "operations": []}\n')
    const before = await tree()
    await expect(planSchemaUpgrade(root, 'E0001-foo', 3)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      reason: 'SCHEMA_UPGRADE_STEP_MISSING',
      message: expect.stringContaining('1-to-2'),
    })
    expect(await tree()).toEqual(before)
  })

  it('chains steps and transforms each file from the version it records', async () => {
    await project({ descriptionVersion: 2 })
    await write(
      `${EXP}/schema-upgrades/2-to-3.json`,
      '{"from": 2, "to": 3, "operations": [{"op": "rename", "from": "metrics.eval.fid", "to": "metrics.eval.fid50k"}]}\n',
    )
    await write(`${B}/result.csv`, csv(2, ['metrics.eval.fid,,11']))
    const plan = await planSchemaUpgrade(root, 'E0001-foo', 3)
    expect(plan.steps.map((step) => `${step.from}-to-${step.to}`)).toEqual(['1-to-2', '2-to-3'])
    const contentAfter = (path: string) => plan.files.find((file) => file.path === path)!.after
    expect(contentAfter(`${A}/result.csv`)).toContain('metrics.eval.fid50k,,12')
    expect(contentAfter(`${B}/result.csv`)).toBe(csv(3, ['metrics.eval.fid50k,,11']))
    // The description recorded 2: only the 2-to-3 step applies to it.
    expect(JSON.parse(contentAfter(`${EXP}/experiment.json`)).columns[0].path).toBe('metrics.fid')
  })

  it('runs a Python transform per file with the documented contract', async () => {
    await project()
    await fs.rm(join(root, EXP, 'schema-upgrades/1-to-2.json'))
    await write(
      `${EXP}/schema-upgrades/1-to-2.py`,
      [
        'import csv, os, sys',
        'rows = list(csv.reader(open(sys.argv[1], newline="")))',
        'with open(sys.argv[2], "w", newline="") as out:',
        '    writer = csv.writer(out, lineterminator="\\n")',
        '    for row in rows:',
        '        if row[0] == "metrics.fid": row[0] = "metrics.eval.fid"',
        '        writer.writerow(row)',
        '    writer.writerow(["metrics.marker", "", os.environ["MEMON_SCHEMA_FROM"] + "-" + os.environ["MEMON_SCHEMA_TO"] + "@" + os.path.basename(os.getcwd())[:21]])',
        '',
      ].join('\n'),
    )
    const before = await tree()
    const plan = await planSchemaUpgrade(root, 'E0001-foo', 2)
    expect(await tree()).toEqual(before)
    const a = plan.files.find((file) => file.path === `${A}/result.csv`)!
    expect(a.after).toContain('$experiment_schema_version,,2\n')
    expect(a.after).toContain('metrics.eval.fid,,12\n')
    expect(a.after).toContain('metrics.marker,,1-2@memon-schema-upgrade-\n')
    const description = JSON.parse(plan.files[0]!.after)
    expect(description.experiment_schema_version).toBe(2)
    expect(description.variants[1].frozen.values[0]).toEqual({
      path: 'metrics.eval.fid',
      stat: null,
      value: 13,
    })
  })
})

describe('applySchemaUpgrade', () => {
  it('backs up, rewrites atomically, verifies and unblocks the summary', async () => {
    await project({ descriptionVersion: 2 })
    // The author raised the description to 2 by hand: the summary is blocked.
    expect((await loadResultsSummary(root, 'E0001-foo'))?.summary.error?.code).toBe(
      'RESULT_SCHEMA_MISMATCH',
    )
    const plan = await planSchemaUpgrade(root, 'E0001-foo', 2)
    const result = await applySchemaUpgrade(root, plan, {
      now: () => new Date(2026, 9, 2, 12, 0, 0),
    })
    expect(result).toEqual({
      status: 'applied',
      backup: '.memon/backups/schema-upgrade/E0001-foo-1-to-2-261002-120000',
      changed: [`${A}/result.csv`, `${B}/result.csv`],
    })
    expect(await read(`${A}/result.csv`)).toContain('$experiment_schema_version,,2')
    expect(await read(`${result.backup}/${A}/result.csv`)).toBe(plan.files[1]!.before)
    expect(await read('.memon/backups/.gitignore')).toBe('*\n')
    expect((await loadResultsSummary(root, 'E0001-foo'))?.summary.outcome).toBe('ok')
    expect(
      (await applySchemaUpgrade(root, await planSchemaUpgrade(root, 'E0001-foo', 2))).status,
    ).toBe('unchanged')
  })

  it('refuses while a member Run is RUNNING and writes nothing', async () => {
    await project({ status: 'RUNNING' })
    const plan = await planSchemaUpgrade(root, 'E0001-foo', 2)
    const before = await tree()
    await expect(applySchemaUpgrade(root, plan)).rejects.toMatchObject({
      code: 'BAD_STATE',
      reason: 'SCHEMA_UPGRADE_RUNNING',
      message: expect.stringContaining(A),
    })
    expect(await tree()).toEqual(before)
  })

  it('restores every file byte for byte when verification fails', async () => {
    await project()
    await write(
      `${EXP}/schema-upgrades/1-to-2.json`,
      '{"from": 1, "to": 2, "operations": [{"op": "rename", "from": "metrics.debug", "to": "metrics.fid"}]}\n',
    )
    const before = await tree()
    const plan = await planSchemaUpgrade(root, 'E0001-foo', 2)
    expect(plan.files[1]!.problems).toEqual([expect.stringContaining('duplicate (metrics.fid')])
    await expect(applySchemaUpgrade(root, plan)).rejects.toMatchObject({
      code: 'BAD_STATE',
      reason: 'SCHEMA_UPGRADE_VERIFY_FAILED',
      message: expect.stringContaining(`${A}/result.csv`),
    })
    expect(await tree()).toEqual(before)
  })

  it('aborts and restores when a file changes between plan and replacement', async () => {
    await project()
    const plan = await planSchemaUpgrade(root, 'E0001-foo', 2)
    await write(`${B}/result.csv`, csv(1, ['metrics.fid,,99']))
    const before = await tree()
    await expect(applySchemaUpgrade(root, plan)).rejects.toMatchObject({
      code: 'CONFLICT',
      reason: 'SCHEMA_UPGRADE_CONFLICT',
    })
    expect(await tree()).toEqual(before)
  })
})
