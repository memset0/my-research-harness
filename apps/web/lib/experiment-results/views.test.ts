// @vitest-environment node

import { describe, expect, it } from 'vitest'
import * as compatibilityPath from '../experiment-results-views'
import { buildColumns } from './columns'
import { column, resultsDocument, variant } from './fixtures.test-helpers'
import { buildColumnTree, isBandGroup, TREE_ROOT } from './tree'
import {
  clampDecimalPlaces,
  completeResultsViewDefinition,
  DEFAULT_RESULTS_VIEW_DEFINITION,
  type ExperimentResultsViewDefinition,
  isExperimentResultsViewDefinition,
  normalizeResultsViewDefinition,
  type ResultsViewDocument,
  resolveViewColumnId,
} from './views'

const SUMMARY = resultsDocument(
  [variant('V1'), variant('V2')],
  [
    column('params.a', 'A'),
    column('params.optim.lr', 'LR'),
    column('metrics.b', 'B'),
    column('metrics.eval.clip', 'CLIP', 'stats', { stats: ['mean', 'std', 'p50', 'p99'] }),
  ],
)
const COLUMNS = buildColumns(SUMMARY)
const TREE = buildColumnTree(COLUMNS, SUMMARY.groups)
const DOCUMENT: ResultsViewDocument = {
  columnIds: COLUMNS.map((entry) => entry.id),
  nodeIds: new Set(TREE.nodes.keys()),
  parentIds: new Set([
    TREE_ROOT,
    ...[...TREE.nodes.values()].filter((node) => !node.column).map((node) => node.id),
  ]),
  collapsibleGroupIds: new Set(
    [...TREE.nodes.values()].filter((node) => isBandGroup(TREE, node)).map((node) => node.id),
  ),
  variantIds: ['V1', 'V2'],
  statOptions: new Map(
    COLUMNS.filter((entry) => entry.statOptions.length > 0).map((entry) => [
      entry.id,
      entry.statOptions,
    ]),
  ),
}

function valid(
  overrides: Partial<ExperimentResultsViewDefinition> = {},
): ExperimentResultsViewDefinition {
  return { ...DEFAULT_RESULTS_VIEW_DEFINITION, ...overrides }
}

const normalize = (value: unknown) => normalizeResultsViewDefinition(value, DOCUMENT)

describe('compatibility path', () => {
  it('re-exports the merged module', () => {
    expect(compatibilityPath.isExperimentResultsViewDefinition).toBe(
      isExperimentResultsViewDefinition,
    )
    expect(compatibilityPath.normalizeResultsViewDefinition).toBe(normalizeResultsViewDefinition)
  })
})

// One row per entry of the validation contract (experiment-results-views).
describe('strict guard', () => {
  it.each<[string, unknown, boolean]>([
    ['defaults', valid(), true],
    [
      'unknown column and Variant ids',
      valid({ hiddenColumnIds: ['gone'], rowOverrides: { V9: 'include' } }),
      true,
    ],
    ['duplicate column order', valid({ columnOrderIds: ['a', 'a'] }), false],
    ['duplicate hidden ids', valid({ hiddenColumnIds: ['a', 'a'] }), false],
    [
      'column pinned on both sides',
      valid({ pinnedColumnIds: { left: ['a'], right: ['a'] } }),
      false,
    ],
    [
      'column pinned twice on one side',
      valid({ pinnedColumnIds: { left: ['a', 'a'], right: [] } }),
      false,
    ],
    [
      'two sort rules on one column',
      valid({
        defaultSortRules: [
          { id: 's1', columnId: 'a', direction: 'asc' },
          { id: 's2', columnId: 'a', direction: 'desc' },
        ],
      }),
      false,
    ],
    [
      'sort rule without id',
      valid({ defaultSortRules: [{ columnId: 'a', direction: 'asc' } as never] }),
      false,
    ],
    [
      'duplicate filter ids',
      valid({
        rowFilters: [
          { id: 'f', columnId: 'a', operator: 'eq', value: '1' },
          { id: 'f', columnId: 'b', operator: 'eq', value: '2' },
        ],
      }),
      false,
    ],
    ['fractional maxLines', valid({ maxLines: 1.5 }), false],
    ['zero maxLines', valid({ maxLines: 0 }), false],
    ['decimal places 12', valid({ decimalPlaces: { a: 12 } }), false],
    ['decimal places 2.5', valid({ decimalPlaces: { a: 2.5 } }), false],
    ['decimal places 0 and 10', valid({ decimalPlaces: { a: 0, b: 10 } }), true],
    ['sota off', valid({ sotaModes: { a: 'off' } }), true],
    [
      'unknown operator',
      valid({ rowFilters: [{ id: 'f', columnId: 'a', operator: 'ge' as never, value: '' }] }),
      false,
    ],
    ['unknown override', valid({ rowOverrides: { V1: 'maybe' as never } }), false],
    ['unknown SOTA mode', valid({ sotaModes: { a: 'best' as never } }), false],
    [
      'node visibility',
      valid({ nodeVisibility: { 'group:params': false, 'params.a': true } }),
      true,
    ],
    ['non-boolean node visibility', valid({ nodeVisibility: { a: 'no' as never } }), false],
    ['tree order', valid({ treeOrder: { $root: ['group:metrics', 'status'] } }), true],
    ['duplicate tree order ids', valid({ treeOrder: { $root: ['a', 'a'] } }), false],
    ['duplicate collapsed groups', valid({ collapsedGroups: ['g', 'g'] }), false],
    [
      'vocabulary stats display and sort',
      valid({
        statsDisplay: { x: 'max.p99', y: 'mean±std', z: 'p50 (p25–p75)' },
        statsSort: { x: 'max.p99', y: 'sem' },
      }),
      true,
    ],
    ['unknown statistic median', valid({ statsDisplay: { x: 'median' } }), false],
    ['template as a sort statistic', valid({ statsSort: { x: 'mean±std' } }), false],
    ['missing field', { ...valid(), decimalPlaces: undefined }, false],
    ['missing tree field', { ...valid(), statsSort: undefined }, false],
    ['array instead of object', [], false],
    ['null', null, false],
  ])('%s', (_name, value, expected) => {
    expect(isExperimentResultsViewDefinition(value)).toBe(expected)
  })
})

describe('legacy column ids', () => {
  const ids = new Set(DOCUMENT.columnIds)
  it.each([
    ['params.a', 'params.a'],
    ['schema:a', 'params.a'],
    ['schema:b', 'metrics.b'],
    ['schema:optim.lr', 'params.optim.lr'],
    ['schema:metrics.old', null],
    ['schema:', null],
    ['gone', null],
  ])('%s → %s', (stored, expected) => {
    expect(resolveViewColumnId(stored, ids)).toBe(expected)
  })

  it('refuses a key present in both partitions', () => {
    expect(resolveViewColumnId('schema:x', new Set(['params.x', 'metrics.x']))).toBeNull()
    expect(resolveViewColumnId('schema:a-1', new Set(['params.a-1']))).toBe('params.a-1')
    expect(resolveViewColumnId('schema:1st', new Set(['metrics._1st']))).toBe('metrics._1st')
  })
})

describe('normalizer', () => {
  it.each<[string, unknown, Partial<ExperimentResultsViewDefinition>, number]>([
    ['non-object falls back to defaults', 'nope', {}, 0],
    ['partial legacy definition', { maxLines: 3 }, { maxLines: 3 }, 0],
    [
      'stale ids dropped silently',
      {
        hiddenColumnIds: ['gone', 'schema:metrics.old'],
        rowOverrides: { V9: 'include', V1: 'exclude' },
        rowFilters: [{ id: 'f', columnId: 'gone', operator: 'eq', value: '' }],
        sotaModes: { gone: 'higher-is-better' },
        decimalPlaces: { gone: 2 },
        nodeVisibility: { 'group:gone': false },
        collapsedGroups: ['group:gone', 'group:params'],
        treeOrder: { 'group:gone': ['x'] },
      },
      { rowOverrides: { V1: 'exclude' } },
      0,
    ],
    [
      'legacy hidden columns fold into node visibility (and resolve their alias)',
      { hiddenColumnIds: ['schema:a', 'status'], nodeVisibility: { status: true } },
      { nodeVisibility: { 'params.a': false, status: true } },
      0,
    ],
    [
      'legacy order resolves aliases and dedupes',
      { columnOrderIds: ['schema:b', 'metrics.b', 'gone', 'variant'] },
      { columnOrderIds: ['metrics.b', 'variant'] },
      0,
    ],
    [
      'double pin keeps the first, counted; the Variant column is never a stored pin',
      { pinnedColumnIds: { left: ['status', 'variant'], right: ['status', 'schema:a'] } },
      { pinnedColumnIds: { left: ['status'], right: ['params.a'] } },
      1,
    ],
    [
      'duplicate sort column keeps the first, counted',
      {
        defaultSortRules: [
          { id: 's1', columnId: 'status', direction: 'asc' },
          { id: 's2', columnId: 'status', direction: 'desc' },
        ],
      },
      { defaultSortRules: [{ id: 's1', columnId: 'status', direction: 'asc' }] },
      1,
    ],
    [
      'missing ids are synthesized, not dropped; legacy ids resolve',
      {
        defaultSortRules: [{ columnId: 'schema:b', direction: 'desc' }],
        rowFilters: [{ columnId: 'schema:a', operator: 'gt', value: '1' }],
      },
      {
        defaultSortRules: [{ id: 'restored-sort-0', columnId: 'metrics.b', direction: 'desc' }],
        rowFilters: [{ id: 'restored-filter-0', columnId: 'params.a', operator: 'gt', value: '1' }],
      },
      0,
    ],
    ['fractional maxLines floored', { maxLines: 2.7 }, { maxLines: 2 }, 0],
    ['NaN maxLines counted', { maxLines: Number.NaN }, { maxLines: 1 }, 1],
    [
      'decimal places floored in range, dropped and counted otherwise',
      { decimalPlaces: { 'params.a': 2.9, 'metrics.b': 11, status: -1, variant: 'x' } },
      { decimalPlaces: { 'params.a': 2 } },
      3,
    ],
    ['SOTA off stored as absence', { sotaModes: { 'metrics.b': 'off' } }, { sotaModes: {} }, 0],
    [
      'stats selections the column does not carry fall back silently; unknown ones count',
      {
        statsDisplay: {
          'metrics.eval.clip': 'p50/p99',
          'metrics.b': 'mean',
          gone: 'mean',
        },
        statsSort: { 'metrics.eval.clip': 'max.p99' },
      },
      { statsDisplay: { 'metrics.eval.clip': 'p50/p99' } },
      0,
    ],
    [
      'an unknown statistic is invalid',
      { statsDisplay: { 'metrics.eval.clip': 'median' }, statsSort: { 'metrics.eval.clip': 'x' } },
      {},
      2,
    ],
    [
      'tree choices keep existing nodes only',
      {
        nodeVisibility: { 'group:params.optim': false, 'params.a': 'no' },
        treeOrder: { $root: ['group:metrics', 'nope'], 'group:params': [1] },
        collapsedGroups: ['group:params.optim', 'group:metrics.eval', 3],
      },
      {
        nodeVisibility: { 'group:params.optim': false },
        treeOrder: { $root: ['group:metrics'] },
        collapsedGroups: ['group:params.optim', 'group:metrics.eval'],
      },
      3,
    ],
    [
      'malformed entries dropped and counted',
      {
        rowFilters: [{ id: 'f', columnId: 'params.a', operator: 'like', value: 'x' }, 'junk'],
        defaultSortRules: [{ id: 's', columnId: 'params.a', direction: 'up' }],
        rowOverrides: { V1: 'maybe' },
        sotaModes: { 'metrics.b': 'best' },
        hiddenColumnIds: [7],
        pinnedColumnIds: { left: 'status', right: [null] },
      },
      {},
      8,
    ],
    [
      'wrong container types counted',
      { rowFilters: {}, rowOverrides: [], decimalPlaces: 'x' },
      {},
      3,
    ],
  ])('%s', (_name, input, expected, invalidCount) => {
    const result = normalize(input)
    expect(result.definition).toEqual(valid(expected))
    expect(result.invalidCount).toBe(invalidCount)
  })

  it('is the identity on a strictly valid definition without stale ids or off modes', () => {
    const definition = valid({
      maxLines: 4,
      defaultSortRules: [{ id: 's', columnId: 'params.a', direction: 'desc' }],
      pinnedColumnIds: { left: ['params.optim.lr'], right: ['metrics.b'] },
      rowFilters: [{ id: 'f', columnId: 'status', operator: 'neq', value: 'FAILED' }],
      rowOverrides: { V2: 'include' },
      sotaModes: { 'metrics.b': 'lower-is-better' },
      decimalPlaces: { 'params.a': 3 },
      nodeVisibility: { 'group:params': false, 'params.a': true },
      treeOrder: { 'group:params': ['params.a', 'group:params.optim'] },
      collapsedGroups: ['group:metrics.eval'],
      statsDisplay: { 'metrics.eval.clip': 'mean±std' },
      statsSort: { 'metrics.eval.clip': 'p99' },
    })
    expect(isExperimentResultsViewDefinition(definition)).toBe(true)
    expect(normalize(definition)).toEqual({ definition, invalidCount: 0 })
  })

  it('completes a legacy definition without a document for seeding', () => {
    const completed = completeResultsViewDefinition({
      hiddenColumnIds: ['schema:a', 'schema:a'],
      columnOrderIds: ['variant', 'schema:a'],
      sotaModes: { 'schema:loss': 'lower-is-better' },
    })
    expect(isExperimentResultsViewDefinition(completed)).toBe(true)
    expect(completed).toMatchObject({
      hiddenColumnIds: ['schema:a'],
      columnOrderIds: ['variant', 'schema:a'],
      sotaModes: { 'schema:loss': 'lower-is-better' },
      nodeVisibility: {},
      statsDisplay: {},
    })
  })

  it.each([
    'junk',
    { maxLines: 0.2, columnOrderIds: ['x', 'status', 'status'] },
    {
      hiddenColumnIds: ['status', 'status', 1],
      pinnedColumnIds: { left: ['a', 'status'], right: ['status'] },
      defaultSortRules: [
        { columnId: 'status', direction: 'asc' },
        { id: 'restored-sort-0', columnId: 'params.a', direction: 'desc' },
      ],
      rowFilters: [{ id: 1, columnId: 'status', operator: 'eq', value: '' }],
      decimalPlaces: { 'params.a': 99 },
      statsDisplay: { 'metrics.eval.clip': 'median' },
      treeOrder: { $root: ['status', 'status'] },
    },
  ])('always produces a strictly valid definition (%#)', (input) => {
    expect(isExperimentResultsViewDefinition(normalize(input).definition)).toBe(true)
    expect(isExperimentResultsViewDefinition(completeResultsViewDefinition(input))).toBe(true)
  })
})

describe('clampDecimalPlaces', () => {
  it.each([
    [-1, 0],
    [2.6, 2],
    [11, 10],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('%d → %d', (value, expected) => {
    expect(clampDecimalPlaces(value)).toBe(expected)
  })
})
