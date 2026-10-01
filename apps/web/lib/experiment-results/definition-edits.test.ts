import { describe, expect, it } from 'vitest'
import * as edits from './definition-edits'
import { DEFAULT_RESULTS_VIEW_DEFINITION, type ExperimentResultsViewDefinition } from './views'

const COLUMNS = ['variant', 'status', 'a', 'b']
const base = (
  overrides: Partial<ExperimentResultsViewDefinition> = {},
): ExperimentResultsViewDefinition => ({
  ...DEFAULT_RESULTS_VIEW_DEFINITION,
  columnOrderIds: [...COLUMNS],
  ...overrides,
})

describe('column edits', () => {
  it('hides and shows without duplicates', () => {
    const hidden = edits.setColumnVisible(edits.setColumnVisible(base(), 'a', false), 'a', false)
    expect(hidden.hiddenColumnIds).toEqual(['a'])
    expect(edits.setColumnVisible(hidden, 'a', true).hiddenColumnIds).toEqual([])
  })

  it('pins, moves and unpins', () => {
    let definition = edits.setColumnPin(base(), 'a', 'left')
    definition = edits.setColumnPin(definition, 'b', 'left')
    expect(definition.pinnedColumnIds).toEqual({ left: ['a', 'b'], right: [] })
    definition = edits.setColumnPin(definition, 'a', 'right')
    expect(definition.pinnedColumnIds).toEqual({ left: ['b'], right: ['a'] })
    expect(edits.setColumnPin(definition, 'a', null).pinnedColumnIds).toEqual({
      left: ['b'],
      right: [],
    })
  })

  it('reorders columns and re-sorts pinned groups by the shared order', () => {
    const definition = base({ pinnedColumnIds: { left: ['a', 'b'], right: [] } })
    const next = edits.reorderColumns(definition, 'b', 'a', 'before')
    expect(next.columnOrderIds).toEqual(['variant', 'status', 'b', 'a'])
    expect(next.pinnedColumnIds.left).toEqual(['b', 'a'])
    expect(edits.reorderColumns(definition, 'a', 'a', 'after')).toBe(definition)
    expect(edits.reorderColumns(definition, 'missing', 'a', 'after')).toBe(definition)
  })

  it.each([
    [3.7, 3],
    [0, 1],
    [Number.NaN, 1],
  ])('sets max lines %d → %d', (value, expected) => {
    expect(edits.setMaxLines(base(), value).maxLines).toBe(expected)
  })
})

describe('filter edits', () => {
  const filter = { id: 'f1', columnId: 'a', operator: 'gt' as const, value: '1' }

  it('appends, replaces in place, reorders and removes', () => {
    let definition = edits.upsertRowFilter(base(), filter)
    definition = edits.upsertRowFilter(definition, { ...filter, id: 'f2', value: '2' })
    definition = edits.upsertRowFilter(definition, { ...filter, value: '9' })
    expect(definition.rowFilters.map((f) => `${f.id}=${f.value}`)).toEqual(['f1=9', 'f2=2'])
    definition = edits.reorderRowFilters(definition, 'f2', 'f1', 'before')
    expect(definition.rowFilters.map((f) => f.id)).toEqual(['f2', 'f1'])
    expect(edits.reorderRowFilters(definition, 'f2', 'f2', 'after')).toBe(definition)
    expect(edits.removeRowFilter(definition, 'f2').rowFilters.map((f) => f.id)).toEqual(['f1'])
  })

  it('sets and clears row overrides', () => {
    const definition = edits.setRowOverride(base(), 'V1', 'include')
    expect(definition.rowOverrides).toEqual({ V1: 'include' })
    expect(edits.setRowOverride(definition, 'V1', null).rowOverrides).toEqual({})
  })
})

describe('sort edits', () => {
  const rule = (id: string, columnId: string, direction: 'asc' | 'desc' = 'asc') => ({
    id,
    columnId,
    direction,
  })

  it('keeps one rule per column when adding or editing', () => {
    let definition = edits.upsertSortRule(base(), rule('s1', 'a'))
    definition = edits.upsertSortRule(definition, rule('s2', 'b'))
    definition = edits.upsertSortRule(definition, rule('s3', 'a'))
    expect(definition.defaultSortRules.map((r) => r.id)).toEqual(['s1', 's2'])
    definition = edits.upsertSortRule(definition, rule('s2', 'a', 'desc'))
    expect(definition.defaultSortRules).toEqual([rule('s1', 'a')])
  })

  it.each([
    ['s2', -1, ['s2', 's1', 's3']],
    ['s2', 1, ['s1', 's3', 's2']],
    ['s1', -1, ['s1', 's2', 's3']],
    ['s3', 1, ['s1', 's2', 's3']],
    ['missing', 1, ['s1', 's2', 's3']],
  ] as const)('moves %s by %d', (id, offset, expected) => {
    const definition = base({
      defaultSortRules: [rule('s1', 'a'), rule('s2', 'b'), rule('s3', 'status')],
    })
    expect(edits.moveSortRule(definition, id, offset).defaultSortRules.map((r) => r.id)).toEqual(
      expected,
    )
  })

  it('reorders by drag and removes', () => {
    const definition = base({ defaultSortRules: [rule('s1', 'a'), rule('s2', 'b')] })
    expect(
      edits.reorderSortRules(definition, 's2', 's1', 'before').defaultSortRules.map((r) => r.id),
    ).toEqual(['s2', 's1'])
    expect(edits.removeSortRule(definition, 's1').defaultSortRules.map((r) => r.id)).toEqual(['s2'])
  })
})

describe('formatting edits', () => {
  it('sets each SOTA mode directly and stores off as absence', () => {
    const lower = edits.setSotaMode(base(), 'a', 'lower-is-better')
    expect(lower.sotaModes).toEqual({ a: 'lower-is-better' })
    expect(edits.setSotaMode(lower, 'a', 'higher-is-better').sotaModes).toEqual({
      a: 'higher-is-better',
    })
    expect(edits.setSotaMode(lower, 'a', 'off').sotaModes).toEqual({})
  })

  it.each([
    [2, 2],
    [-1, 0],
    [11, 10],
    [2.5, 2],
  ])('clamps decimal places %d → %d', (value, expected) => {
    expect(edits.setDecimalPlaces(base(), 'a', value).decimalPlaces).toEqual({ a: expected })
  })
})

describe('isPristineView', () => {
  const clean = { showAllColumns: false, showAllRows: false, hasTemporarySort: false }
  it.each<[string, ExperimentResultsViewDefinition, typeof clean, boolean]>([
    ['defaults', base(), clean, true],
    ['custom order', base({ columnOrderIds: ['status', 'variant', 'a', 'b'] }), clean, false],
    ['hidden column', base({ hiddenColumnIds: ['a'] }), clean, false],
    ['decimal places', base({ decimalPlaces: { a: 1 } }), clean, false],
    ['max lines', base({ maxLines: 2 }), clean, false],
    ['temporary sort', base(), { ...clean, hasTemporarySort: true }, false],
    ['show all rows', base(), { ...clean, showAllRows: true }, false],
  ])('%s', (_name, definition, transient, expected) => {
    expect(edits.isPristineView(definition, COLUMNS, transient)).toBe(expected)
  })
})

describe('newEntryId', () => {
  it('is unique per sequence number', () => {
    expect(edits.newEntryId('filter', 1)).not.toBe(edits.newEntryId('filter', 2))
    expect(edits.newEntryId('sort', 0)).toMatch(/^sort-\d+-0$/)
  })
})
