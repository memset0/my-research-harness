import { describe, expect, it } from 'vitest'
import { VARIANT_STATUS_VALUES } from '../types.js'
import {
  DECLARABLE_VARIANT_STATUSES,
  EXPERIMENT_DESCRIPTION_FILE,
  emptyExperimentDescription,
  lintExperimentDescription,
  parseExperimentDescription,
  patchExperimentDescription,
  renameDescriptionRunPath,
  serializeExperimentDescription,
  upsertDescriptionColumnAnnotation,
} from './description.js'
import schema from './experiment.schema.json' with { type: 'json' }
import { RESULT_VALUE_TYPES } from './result-file.js'
import { DISPLAY_TEMPLATES, NUMBER_FORMATS, STAT_VOCABULARY } from './vocabulary.js'

const DESIGN_EXAMPLE = {
  experiment_schema_version: 2,
  groups: { 'params.optim': { label: 'Optimizer' }, env: { hidden: true } },
  columns: [
    { path: 'params.optim.lr', label: 'LR', type: 'number' },
    {
      path: 'params.precision',
      label: 'Precision',
      type: 'enum',
      options: ['fp32', 'bf16'],
      description: 'Training precision.',
      value_descriptions: { bf16: 'bfloat16 autocast' },
    },
    { path: 'metrics.eval.fid', label: 'FID', type: 'number', direction: 'lower' },
    {
      path: 'metrics.eval.clip',
      label: 'CLIP',
      type: 'stats',
      across: 'sample',
      direction: 'higher',
      display: 'mean±std',
    },
    {
      path: 'metrics.serve.latency_ms',
      label: 'Latency',
      type: 'stats',
      unit: 'ms',
      direction: 'lower',
      across: 'request',
      over: 'gpu',
      display: 'max.p99',
    },
    { path: 'env.CUDA_VERSION', label: 'CUDA', type: 'string' },
  ],
  variants: [
    {
      id: 'V0001',
      name: 'baseline',
      status: 'PLANNED',
      values: { 'params.optim.lr': 0.0001, 'params.precision': 'bf16', 'env.CUDA_VERSION': '12.4' },
      provenance: {
        repo: 'project-a',
        commit: 'abc1234',
        entry: 'scripts/train.sh',
        recipe: 'configs/a.yaml',
      },
      runs: ['logs/a-260901-090000', 'logs/a-260902-100000'],
    },
    {
      id: 'V0009',
      name: 'historical',
      runs: [],
      frozen: {
        status: 'COMPLETED',
        runs: ['logs/gone-260101-000000'],
        source: 'results.yaml@0123abc',
        values: [{ path: 'metrics.eval.fid', stat: null, value: 13.1 }],
      },
    },
  ],
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

describe('parseExperimentDescription', () => {
  it('reads the design example', () => {
    const parsed = parseExperimentDescription(json(DESIGN_EXAMPLE))
    expect(parsed.parseErrors).toEqual([])
    expect(parsed.parseWarnings).toEqual([])
    expect(parsed.data).toMatchObject({
      experimentSchemaVersion: 2,
      groups: { 'params.optim': { label: 'Optimizer' }, env: { hidden: true } },
    })
    expect(parsed.data!.columns[1]).toMatchObject({
      valueDescriptions: { bf16: 'bfloat16 autocast' },
    })
    expect(parsed.data!.variants[1]!.frozen).toEqual({
      status: 'COMPLETED',
      runs: ['logs/gone-260101-000000'],
      source: 'results.yaml@0123abc',
      values: [{ path: 'metrics.eval.fid', stat: null, value: 13.1 }],
    })
  })

  it('reads a blocked Variant without diagnostics', () => {
    const parsed = parseExperimentDescription(
      json({
        experiment_schema_version: 1,
        variants: [
          {
            id: 'V0001',
            name: 'child',
            status: 'BLOCKED',
            description: 'waits for the V0000 checkpoint',
            runs: [],
          },
        ],
      }),
    )
    expect(parsed.parseErrors).toEqual([])
    expect(parsed.data!.variants[0]!.status).toBe('BLOCKED')
    expect(lintExperimentDescription(parsed.data!, { readmeRuns: [] })).toEqual([])
  })

  it('rejects an unknown status with the four declarable statuses', () => {
    const parsed = parseExperimentDescription(
      json({
        experiment_schema_version: 1,
        variants: [{ id: 'V0001', name: 'x', status: 'WAITING' }],
      }),
    )
    expect(parsed.data).toBeNull()
    expect(parsed.parseErrors).toHaveLength(1)
    expect(parsed.parseErrors[0]!.field).toBe('variants.0.status')
    expect(parsed.parseErrors[0]!.message).toMatch(/^INVALID_RESULTS_SCHEMA: /)
    for (const status of DECLARABLE_VARIANT_STATUSES)
      expect(parsed.parseErrors[0]!.message).toContain(status)
  })

  it('coerces numeric and boolean env values with a warning', () => {
    const parsed = parseExperimentDescription(
      json({
        experiment_schema_version: 1,
        variants: [
          {
            id: 'V0001',
            name: 'x',
            values: { 'env.LR': 0.000008, 'env.DEBUG': true, 'env.TINY': 1e-7, 'params.lr': 0.1 },
          },
        ],
      }),
    )
    expect(parsed.data!.variants[0]!.values).toEqual({
      'env.LR': '0.000008',
      'env.DEBUG': 'true',
      'env.TINY': '1e-7',
      'params.lr': 0.1,
    })
    expect(parsed.parseWarnings.map((warning) => warning.field)).toEqual([
      'variants.0.values.env.LR',
      'variants.0.values.env.DEBUG',
      'variants.0.values.env.TINY',
    ])
    expect(parsed.parseWarnings[0]!.message).toMatch(/^RESULTS_ENV_VALUE_COERCED: .*"0\.000008"/)
  })

  it('rejects a null env value', () => {
    const parsed = parseExperimentDescription(
      json({
        experiment_schema_version: 1,
        variants: [{ id: 'V0001', name: 'x', values: { 'env.LR': null } }],
      }),
    )
    expect(parsed.data).toBeNull()
    expect(parsed.parseErrors[0]).toMatchObject({ field: 'variants.0.values.env.LR' })
  })

  it('reports invalid JSON with its position and schema violations', () => {
    expect(
      parseExperimentDescription('{\n  "experiment_schema_version": 1,\n}\n').parseErrors[0]!
        .message,
    ).toMatch(/^INVALID_JSON: .*line \d+, column \d+/)
    const invalid = parseExperimentDescription(
      json({
        experiment_schema_version: 0,
        columns: [
          { path: 'metrics', label: 'x', type: 'number' },
          { path: 'params.p', label: 'P', type: 'enum' },
          { path: 'metrics.lat', label: 'L', type: 'stats', over: 'gpu', display: 'p99' },
          { path: 'metrics.x', label: 'X', type: 'string', display: 'mean' },
          { path: 'metrics.y', label: 'Y', type: 'stats', display: 'median' },
        ],
      }),
    )
    expect(invalid.parseErrors.map((issue) => issue.field)).toEqual([
      'experiment_schema_version',
      'columns.0.path',
      'columns.1.options',
      'columns.2.display',
      'columns.3.display',
      'columns.4.display',
    ])
  })
})

describe('serialization', () => {
  it('writes two-space JSON with canonical key order, keeps unknown keys and env strings', () => {
    const source = {
      variants: [
        {
          runs: [],
          name: 'x',
          id: 'V0001',
          custom: { keep: true },
          values: { 'env.LR': 0.5 },
        },
      ],
      notes: 'kept',
      columns: [{ type: 'number', label: 'FID', path: 'metrics.fid', x_ui: 1 }],
      experiment_schema_version: 3,
    }
    const parsed = parseExperimentDescription(JSON.stringify(source))
    const text = serializeExperimentDescription(parsed.data!)
    expect(text).toBe(
      `${JSON.stringify(
        {
          experiment_schema_version: 3,
          groups: {},
          columns: [{ path: 'metrics.fid', label: 'FID', type: 'number', x_ui: 1 }],
          variants: [
            {
              id: 'V0001',
              name: 'x',
              values: { 'env.LR': '0.5' },
              runs: [],
              custom: { keep: true },
            },
          ],
          notes: 'kept',
        },
        null,
        2,
      )}\n`,
    )
    const again = parseExperimentDescription(text)
    expect(again.parseWarnings).toEqual([])
    expect(serializeExperimentDescription(again.data!)).toBe(text)
  })

  it('serializes an empty description', () => {
    expect(serializeExperimentDescription(emptyExperimentDescription())).toBe(
      '{\n  "experiment_schema_version": 1,\n  "groups": {},\n  "columns": [],\n  "variants": []\n}\n',
    )
  })

  it('replaces exactly one annotation and keeps unrelated keys', () => {
    const content = json({
      ...DESIGN_EXAMPLE,
      extra_top: 1,
    })
    const result = upsertDescriptionColumnAnnotation(
      content,
      'params.precision',
      'new bf16 text',
      'bf16',
    )
    expect(result).toMatchObject({ replaced: true, changed: true })
    const after = JSON.parse(result.content)
    expect(after.extra_top).toBe(1)
    expect(after.columns[1].value_descriptions).toEqual({ bf16: 'new bf16 text' })
    expect(after.columns[1].description).toBe('Training precision.')
    expect(() => upsertDescriptionColumnAnnotation(content, 'params.unknown', 'x')).toThrow(
      /not declared/,
    )
  })

  it('renames a Variant Run path', () => {
    const patched = patchExperimentDescription(json(DESIGN_EXAMPLE), (description) => {
      expect(
        renameDescriptionRunPath(description, 'logs/a-260901-090000', 'logs/b-260901-090000'),
      ).toBe(true)
    })
    expect(JSON.parse(patched.content).variants[0].runs).toEqual([
      'logs/b-260901-090000',
      'logs/a-260902-100000',
    ])
  })
})

describe('lintExperimentDescription', () => {
  it('reports README duplicates, derived statuses, membership and duplicate declarations', () => {
    const parsed = parseExperimentDescription(
      json({
        experiment_schema_version: 1,
        status: 'OPEN',
        runs: ['logs/a-260901-090000'],
        columns: [
          { path: 'metrics.eval', label: 'E', type: 'number' },
          { path: 'metrics.eval.fid', label: 'F', type: 'number' },
          { path: 'metrics.eval.fid', label: 'F2', type: 'number' },
          { path: 'params.p', label: 'P', type: 'enum', options: ['a', 'a'] },
          { path: 'params.lr', label: 'LR', type: 'number' },
        ],
        variants: [
          {
            id: 'V0001',
            name: 'one',
            status: 'COMPLETED',
            values: { 'params.lr': 'fast', 'metrics.eval.fid': 1 },
            runs: ['logs/a-260901-090000', 'logs/x-260901-090000'],
          },
          { id: 'V0002', name: 'two', runs: ['logs/a-260901-090000'] },
          { id: 'V0002', name: 'three', runs: [] },
        ],
      }),
    )
    const codes = lintExperimentDescription(parsed.data!, {
      readmeRuns: ['logs/a-260901-090000', 'logs/b-260901-090000'],
    }).map((diagnostic) => diagnostic.code)
    expect(codes).toEqual([
      'DESCRIPTION_DUPLICATES_README',
      'DESCRIPTION_DUPLICATES_README',
      'DUPLICATE_RESULT_COLUMN',
      'DUPLICATE_ENUM_OPTION',
      'RESULT_PATH_CONFLICT',
      'DERIVED_STATUS_DECLARED',
      'RESULT_VALUE_TYPE_MISMATCH',
      'VARIANT_VALUE_PARTITION',
      'RUN_ASSIGNED_TO_MULTIPLE_VARIANTS',
      'DUPLICATE_VARIANT_ID',
      'VARIANT_RUN_NOT_EXPERIMENT_MEMBER',
      'UNASSIGNED_EXPERIMENT_RUN',
    ])
  })

  it('keeps an unused enum option and sparse value descriptions valid', () => {
    const parsed = parseExperimentDescription(
      json({
        experiment_schema_version: 1,
        columns: [
          {
            path: 'params.precision',
            label: 'Precision',
            type: 'enum',
            options: ['fp32', 'bf16', 'fp8'],
            value_descriptions: { bf16: 'b', fp4: 'future' },
          },
        ],
        variants: [{ id: 'V0001', name: 'x', values: { 'params.precision': 'bf16' } }],
      }),
    )
    expect(lintExperimentDescription(parsed.data!, { readmeRuns: [] })).toEqual([])
  })
})

describe('editor JSON Schema', () => {
  it('mirrors the core vocabularies', () => {
    const defs = schema.$defs
    expect(defs.column.properties.type.enum).toEqual([...RESULT_VALUE_TYPES])
    expect(defs.column.properties.format.enum).toEqual([...NUMBER_FORMATS])
    expect(defs.oneLevelStat.enum).toEqual([...STAT_VOCABULARY])
    expect(defs.display.anyOf[1]!.enum).toEqual([...DISPLAY_TEMPLATES])
    expect(defs.status.enum).toEqual([...VARIANT_STATUS_VALUES])
    expect(defs.declarableStatus.enum).toEqual([...DECLARABLE_VARIANT_STATUSES])
    expect(new RegExp(defs.statKey.pattern).test('max.p99')).toBe(true)
    expect(new RegExp(defs.statKey.pattern).test('median')).toBe(false)
    expect(EXPERIMENT_DESCRIPTION_FILE).toBe('experiment.json')
  })
})
