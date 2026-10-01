import { describe, expect, it } from 'vitest'
import * as compatibilityPath from '../experiment-results-views'
import {
  clampDecimalPlaces,
  DEFAULT_RESULTS_VIEW_DEFINITION,
  type ExperimentResultsViewDefinition,
  isExperimentResultsViewDefinition,
  normalizeResultsViewDefinition,
} from './views'

const COLUMNS = ['variant', 'status', 'schema:a', 'schema:b']
const VARIANTS = ['V1', 'V2']

function valid(
  overrides: Partial<ExperimentResultsViewDefinition> = {},
): ExperimentResultsViewDefinition {
  return {
    ...DEFAULT_RESULTS_VIEW_DEFINITION,
    columnOrderIds: [...COLUMNS],
    ...overrides,
  }
}

const normalize = (value: unknown) => normalizeResultsViewDefinition(value, COLUMNS, VARIANTS)

describe('compatibility path', () => {
  it('re-exports the merged module', () => {
    expect(compatibilityPath.isExperimentResultsViewDefinition).toBe(
      isExperimentResultsViewDefinition,
    )
    expect(compatibilityPath.normalizeResultsViewDefinition).toBe(normalizeResultsViewDefinition)
  })
})

// One row per entry of the design difference table (design.md D2).
describe('strict guard', () => {
  it.each<[string, unknown, boolean]>([
    ['defaults', valid(), true],
    [
      'unknown column and Variant ids (row 1)',
      valid({ hiddenColumnIds: ['gone'], rowOverrides: { V9: 'include' } }),
      true,
    ],
    ['duplicate column order (row 2)', valid({ columnOrderIds: ['a', 'a'] }), false],
    ['duplicate hidden ids (row 3)', valid({ hiddenColumnIds: ['a', 'a'] }), false],
    [
      'column pinned on both sides (row 4)',
      valid({ pinnedColumnIds: { left: ['a'], right: ['a'] } }),
      false,
    ],
    [
      'column pinned twice on one side (row 4)',
      valid({ pinnedColumnIds: { left: ['a', 'a'], right: [] } }),
      false,
    ],
    [
      'two sort rules on one column (row 5)',
      valid({
        defaultSortRules: [
          { id: 's1', columnId: 'a', direction: 'asc' },
          { id: 's2', columnId: 'a', direction: 'desc' },
        ],
      }),
      false,
    ],
    [
      'sort rule without id (row 6)',
      valid({ defaultSortRules: [{ columnId: 'a', direction: 'asc' } as never] }),
      false,
    ],
    [
      'duplicate filter ids (row 7)',
      valid({
        rowFilters: [
          { id: 'f', columnId: 'a', operator: 'eq', value: '1' },
          { id: 'f', columnId: 'b', operator: 'eq', value: '2' },
        ],
      }),
      false,
    ],
    ['fractional maxLines (row 8)', valid({ maxLines: 1.5 }), false],
    ['zero maxLines (row 8)', valid({ maxLines: 0 }), false],
    ['decimal places 12 (row 9)', valid({ decimalPlaces: { a: 12 } }), false],
    ['decimal places 2.5 (row 9)', valid({ decimalPlaces: { a: 2.5 } }), false],
    ['decimal places 0 and 10 (row 9)', valid({ decimalPlaces: { a: 0, b: 10 } }), true],
    ['sota off (row 10)', valid({ sotaModes: { a: 'off' } }), true],
    [
      'unknown operator (row 11)',
      valid({ rowFilters: [{ id: 'f', columnId: 'a', operator: 'ge' as never, value: '' }] }),
      false,
    ],
    ['unknown override (row 11)', valid({ rowOverrides: { V1: 'maybe' as never } }), false],
    ['unknown SOTA mode (row 11)', valid({ sotaModes: { a: 'best' as never } }), false],
    ['missing field (row 12)', { ...valid(), decimalPlaces: undefined }, false],
    ['array instead of object', [], false],
    ['null', null, false],
  ])('%s', (_name, value, expected) => {
    expect(isExperimentResultsViewDefinition(value)).toBe(expected)
  })
})

describe('normalizer', () => {
  it.each<[string, unknown, Partial<ExperimentResultsViewDefinition>, number]>([
    ['non-object falls back to defaults (row 12)', 'nope', {}, 0],
    ['partial legacy definition (row 12)', { maxLines: 3 }, { maxLines: 3 }, 0],
    [
      'stale ids dropped silently (row 1)',
      {
        hiddenColumnIds: ['gone', 'schema:a'],
        rowOverrides: { V9: 'include', V1: 'exclude' },
        rowFilters: [{ id: 'f', columnId: 'gone', operator: 'eq', value: '' }],
        sotaModes: { gone: 'higher-is-better' },
        decimalPlaces: { gone: 2 },
      },
      { hiddenColumnIds: ['schema:a'], rowOverrides: { V1: 'exclude' } },
      0,
    ],
    [
      'duplicate and partial order deduped and completed (row 2)',
      { columnOrderIds: ['schema:b', 'schema:b', 'gone', 'variant'] },
      { columnOrderIds: ['schema:b', 'variant', 'status', 'schema:a'] },
      0,
    ],
    [
      'duplicate hidden ids deduped (row 3)',
      { hiddenColumnIds: ['status', 'status'] },
      { hiddenColumnIds: ['status'] },
      0,
    ],
    [
      'double pin keeps the first, counted (row 4)',
      { pinnedColumnIds: { left: ['status'], right: ['status', 'schema:a'] } },
      { pinnedColumnIds: { left: ['status'], right: ['schema:a'] } },
      1,
    ],
    [
      'duplicate sort column keeps the first, counted (row 5)',
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
      'missing ids are synthesized, not dropped (row 6)',
      {
        defaultSortRules: [{ columnId: 'status', direction: 'desc' }],
        rowFilters: [{ columnId: 'schema:a', operator: 'gt', value: '1' }],
      },
      {
        defaultSortRules: [{ id: 'restored-sort-0', columnId: 'status', direction: 'desc' }],
        rowFilters: [{ id: 'restored-filter-0', columnId: 'schema:a', operator: 'gt', value: '1' }],
      },
      0,
    ],
    [
      'duplicate ids are replaced, not dropped (row 7)',
      {
        rowFilters: [
          { id: 'f', columnId: 'schema:a', operator: 'eq', value: '1' },
          { id: 'f', columnId: 'schema:b', operator: 'eq', value: '2' },
          { id: 'restored-filter-1', columnId: 'schema:b', operator: 'lt', value: '3' },
        ],
      },
      {
        rowFilters: [
          { id: 'f', columnId: 'schema:a', operator: 'eq', value: '1' },
          { id: 'restored-filter-1', columnId: 'schema:b', operator: 'eq', value: '2' },
          { id: 'restored-filter-2', columnId: 'schema:b', operator: 'lt', value: '3' },
        ],
      },
      0,
    ],
    ['fractional maxLines floored (row 8)', { maxLines: 2.7 }, { maxLines: 2 }, 0],
    ['negative maxLines clamped (row 8)', { maxLines: -3 }, { maxLines: 1 }, 0],
    ['NaN maxLines counted (row 8)', { maxLines: Number.NaN }, { maxLines: 1 }, 1],
    [
      'decimal places floored in range, dropped and counted otherwise (row 9)',
      { decimalPlaces: { 'schema:a': 2.9, 'schema:b': 11, status: -1, variant: 'x' } },
      { decimalPlaces: { 'schema:a': 2 } },
      3,
    ],
    [
      'SOTA off stored as absence (row 10)',
      { sotaModes: { 'schema:a': 'off' } },
      { sotaModes: {} },
      0,
    ],
    [
      'malformed entries dropped and counted (row 11)',
      {
        rowFilters: [{ id: 'f', columnId: 'schema:a', operator: 'like', value: 'x' }, 'junk'],
        defaultSortRules: [{ id: 's', columnId: 'schema:a', direction: 'up' }],
        rowOverrides: { V1: 'maybe' },
        sotaModes: { 'schema:a': 'best' },
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

  it('handles an empty document', () => {
    const result = normalizeResultsViewDefinition(
      { hiddenColumnIds: ['a'], rowOverrides: { V1: 'include' } },
      [],
      [],
    )
    expect(result).toEqual({ definition: DEFAULT_RESULTS_VIEW_DEFINITION, invalidCount: 0 })
  })

  it('is the identity on a strictly valid definition without stale ids or off modes', () => {
    const definition = valid({
      hiddenColumnIds: ['status'],
      columnOrderIds: ['schema:b', 'variant', 'status', 'schema:a'],
      maxLines: 4,
      defaultSortRules: [{ id: 's', columnId: 'schema:a', direction: 'desc' }],
      pinnedColumnIds: { left: ['variant'], right: ['schema:b'] },
      rowFilters: [{ id: 'f', columnId: 'status', operator: 'neq', value: 'FAILED' }],
      rowOverrides: { V2: 'include' },
      sotaModes: { 'schema:a': 'lower-is-better' },
      decimalPlaces: { 'schema:a': 3 },
    })
    expect(isExperimentResultsViewDefinition(definition)).toBe(true)
    expect(normalize(definition)).toEqual({ definition, invalidCount: 0 })
  })

  it.each([
    'junk',
    { maxLines: 0.2, columnOrderIds: ['x', 'status', 'status'] },
    {
      hiddenColumnIds: ['status', 'status', 1],
      pinnedColumnIds: { left: ['a', 'status'], right: ['status'] },
      defaultSortRules: [
        { columnId: 'status', direction: 'asc' },
        { id: 'restored-sort-0', columnId: 'schema:a', direction: 'desc' },
      ],
      rowFilters: [{ id: 1, columnId: 'status', operator: 'eq', value: '' }],
      decimalPlaces: { 'schema:a': 99 },
    },
  ])('always produces a strictly valid definition (%#)', (input) => {
    expect(isExperimentResultsViewDefinition(normalize(input).definition)).toBe(true)
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
