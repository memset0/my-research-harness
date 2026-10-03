// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { buildColumns } from './columns'
import * as edits from './definition-edits'
import { column, resultsDocument } from './fixtures.test-helpers'
import { buildColumnTree } from './tree'
import { DEFAULT_RESULTS_VIEW_DEFINITION, type ExperimentResultsViewDefinition } from './views'

const base = (
  overrides: Partial<ExperimentResultsViewDefinition> = {},
): ExperimentResultsViewDefinition => ({
  ...DEFAULT_RESULTS_VIEW_DEFINITION,
  ...overrides,
})

const TREE = buildColumnTree(
  buildColumns(
    resultsDocument(
      [],
      [
        column('params.optim.lr', 'LR'),
        column('params.optim.batch_size', 'Batch size'),
        column('params.model.depth', 'Depth'),
        column('metrics.eval.fid', 'FID'),
      ],
    ),
  ),
  {},
)

describe('tree edits', () => {
  it('stores a check on the changed node and clears descendant choices', () => {
    let definition = edits.setNodeVisible(base(), TREE, 'params.optim.lr', false)
    expect(definition.nodeVisibility).toEqual({ 'params.optim.lr': false })
    definition = edits.setNodeVisible(definition, TREE, 'group:params.optim', true)
    expect(definition.nodeVisibility).toEqual({ 'group:params.optim': true })
    definition = edits.setNodeVisible(definition, TREE, 'group:params', false)
    expect(definition.nodeVisibility).toEqual({ 'group:params': false })
    expect(edits.setNodeVisible(definition, TREE, 'nope', true)).toBe(definition)
  })

  it('reorders within the parent and refuses a drop into another group', () => {
    const moved = edits.reorderTreeNode(
      base(),
      TREE,
      'params.optim.batch_size',
      'params.optim.lr',
      'before',
    )
    expect(moved.treeOrder).toEqual({
      'group:params.optim': ['params.optim.batch_size', 'params.optim.lr'],
    })
    // Groups move as one block among their siblings.
    expect(
      edits.reorderTreeNode(base(), TREE, 'group:params.model', 'group:params.optim', 'before')
        .treeOrder,
    ).toEqual({ 'group:params': ['group:params.model', 'group:params.optim'] })
    const refused = base()
    expect(
      edits.reorderTreeNode(refused, TREE, 'params.optim.lr', 'params.model.depth', 'after'),
    ).toBe(refused)
  })

  it('pins at the end of the left zone, folds stored right pins in and unpins', () => {
    let definition = base({ pinnedColumnIds: { left: ['a'], right: ['r'] } })
    expect(edits.pinnedOrder(definition)).toEqual(['a', 'r'])
    definition = edits.setColumnPinned(definition, 'b', true)
    expect(definition.pinnedColumnIds).toEqual({ left: ['a', 'r', 'b'], right: [] })
    expect(edits.setColumnPinned(definition, 'variant', true)).toBe(definition)
    expect(edits.setColumnPinned(definition, 'b', true)).toBe(definition)
    definition = edits.reorderPinned(definition, 'b', 'a', 'before')
    expect(definition.pinnedColumnIds.left).toEqual(['b', 'a', 'r'])
    expect(edits.setColumnPinned(definition, 'a', false).pinnedColumnIds.left).toEqual(['b', 'r'])
  })

  it('toggles collapsed groups and stats choices', () => {
    const collapsed = edits.toggleGroupCollapsed(base(), 'group:metrics.eval')
    expect(collapsed.collapsedGroups).toEqual(['group:metrics.eval'])
    expect(edits.toggleGroupCollapsed(collapsed, 'group:metrics.eval').collapsedGroups).toEqual([])
    let stats = edits.setStatsSort(base(), 'metrics.clip', 'std')
    stats = edits.setStatsDisplay(stats, 'metrics.clip', 'p50/p99')
    // Choosing a display also decides the sort statistic again.
    expect(stats.statsDisplay).toEqual({ 'metrics.clip': 'p50/p99' })
    expect(stats.statsSort).toEqual({})
    expect(edits.setStatsDisplay(stats, 'metrics.clip', null).statsDisplay).toEqual({})
    expect(edits.setStatsSort(stats, 'metrics.clip', 'p99').statsSort).toEqual({
      'metrics.clip': 'p99',
    })
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
    ['tree order', base({ treeOrder: { $root: ['group:metrics'] } }), clean, false],
    ['legacy order', base({ columnOrderIds: ['status', 'variant'] }), clean, false],
    ['hidden node', base({ nodeVisibility: { 'params.lr': false } }), clean, false],
    ['collapsed group', base({ collapsedGroups: ['group:metrics.eval'] }), clean, false],
    ['stats display', base({ statsDisplay: { 'metrics.clip': 'p99' } }), clean, false],
    ['decimal places', base({ decimalPlaces: { a: 1 } }), clean, false],
    ['max lines', base({ maxLines: 2 }), clean, false],
    ['temporary sort', base(), { ...clean, hasTemporarySort: true }, false],
    ['show all rows', base(), { ...clean, showAllRows: true }, false],
  ])('%s', (_name, definition, transient, expected) => {
    expect(edits.isPristineView(definition, transient)).toBe(expected)
  })
})

describe('newEntryId', () => {
  it('is unique per sequence number', () => {
    expect(edits.newEntryId('filter', 1)).not.toBe(edits.newEntryId('filter', 2))
    expect(edits.newEntryId('sort', 0)).toMatch(/^sort-\d+-0$/)
  })
})
