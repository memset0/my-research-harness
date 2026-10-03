// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { buildColumns } from './columns'
import { column, resultsDocument } from './fixtures.test-helpers'
import {
  bandCells,
  buildColumnTree,
  childIds,
  columnBreadcrumb,
  columnHeaderLabel,
  isLeafVisible,
  layoutGrid,
  nodeCheckState,
  TREE_ROOT,
} from './tree'

const COLUMNS = [
  column('params.optim.lr', 'LR'),
  column('params.optim.batch_size', 'Batch size'),
  column('params.optim.adam.beta1', 'beta1'),
  column('params.model.depth', 'Depth'),
  column('params.seed', 'seed'),
  column('metrics.eval.fid', 'FID'),
  column('metrics.eval.clip', 'CLIP', 'stats', { stats: ['mean', 'std'] }),
  column('metrics.eval.lpips', 'lpips', 'number', { declared: false }),
  column('env.CUDA', 'CUDA', 'string'),
]
const GROUPS = { 'params.optim': { label: 'Optimizer' } }
const columns = buildColumns(resultsDocument([], COLUMNS, GROUPS))
const tree = (order: Parameters<typeof buildColumnTree>[2] = {}) =>
  buildColumnTree(columns, GROUPS, order)

describe('buildColumnTree', () => {
  it('builds Status, partitions, groups and Provenance in declaration order', () => {
    const built = tree()
    expect(childIds(built, TREE_ROOT)).toEqual([
      'status',
      'group:params',
      'group:metrics',
      'group:env',
      'group:$provenance',
    ])
    expect(childIds(built, 'group:params')).toEqual([
      'group:params.optim',
      'group:params.model',
      'params.seed',
    ])
    expect(childIds(built, 'group:params.optim')).toEqual([
      'params.optim.lr',
      'params.optim.batch_size',
      'group:params.optim.adam',
    ])
    expect(built.nodes.get('group:params.optim')?.label).toBe('Optimizer')
    expect(built.nodes.get('group:params')).toMatchObject({
      kind: 'partition',
      label: 'Parameters',
    })
    expect(built.leafOrder.slice(0, 4)).toEqual([
      'status',
      'params.optim.lr',
      'params.optim.batch_size',
      'params.optim.adam.beta1',
    ])
  })

  it('restores a partial saved order: stale and duplicate ids drop, new columns append to their group', () => {
    const built = tree({
      treeOrder: {
        'group:metrics.eval': [
          'metrics.eval.clip',
          'gone',
          'metrics.eval.clip',
          'metrics.eval.fid',
        ],
      },
    })
    expect(childIds(built, 'group:metrics.eval')).toEqual([
      'metrics.eval.clip',
      'metrics.eval.fid',
      'metrics.eval.lpips',
    ])
  })

  it('orders parents without a saved order by a legacy flat order', () => {
    const built = tree({ legacyOrder: ['metrics.eval.fid', 'params.seed', 'params.optim.lr'] })
    expect(childIds(built, TREE_ROOT).slice(0, 3)).toEqual([
      'group:metrics',
      'group:params',
      'status',
    ])
    expect(childIds(built, 'group:params')[0]).toBe('params.seed')
  })
})

describe('visibility', () => {
  const built = tree()
  it('inherits the nearest explicit choice, else the description default (env hidden)', () => {
    expect(isLeafVisible(built, 'env.CUDA', {})).toBe(false)
    expect(isLeafVisible(built, 'params.optim.lr', {})).toBe(true)
    const choices = { 'group:params.optim': false, 'params.optim.lr': true, 'group:env': true }
    expect(isLeafVisible(built, 'params.optim.lr', choices)).toBe(true)
    expect(isLeafVisible(built, 'params.optim.batch_size', choices)).toBe(false)
    expect(isLeafVisible(built, 'params.optim.adam.beta1', choices)).toBe(false)
    expect(isLeafVisible(built, 'env.CUDA', choices)).toBe(true)
  })

  it('renders a partly visible group as indeterminate', () => {
    const visible = (id: string) =>
      isLeafVisible(built, id, { 'group:params.optim': true, 'params.optim.batch_size': false })
    expect(nodeCheckState(built.nodes.get('group:params.optim')!, visible)).toBe('indeterminate')
    expect(nodeCheckState(built.nodes.get('group:params.model')!, visible)).toBe(true)
    expect(nodeCheckState(built.nodes.get('group:env')!, visible)).toBe(false)
  })
})

describe('layoutGrid', () => {
  const built = tree()
  const variant = columns[0]!
  const all = () => true

  it('walks the tree depth first so a group stays contiguous', () => {
    const layout = layoutGrid(built, variant, { visible: all, pinned: [], collapsed: new Set() })
    expect(layout.pinned.map((item) => item.id)).toEqual(['variant'])
    const ids = layout.unpinned.map((item) => item.id)
    expect(ids.slice(1, 6)).toEqual([
      'params.optim.lr',
      'params.optim.batch_size',
      'params.optim.adam.beta1',
      'params.model.depth',
      'params.seed',
    ])
  })

  it('stacks two header levels with deeper groups merged into the label', () => {
    const lr = built.nodes.get('params.optim.lr')!.column!
    const beta1 = built.nodes.get('params.optim.adam.beta1')!.column!
    expect(columnHeaderLabel(built, lr)).toBe('LR')
    expect(columnHeaderLabel(built, beta1)).toBe('adam › beta1')
    expect(columnBreadcrumb(built, lr)).toBe('Optimizer › LR')
    const layout = layoutGrid(built, variant, {
      visible: (id) => id.startsWith('params.optim') || id === 'params.seed',
      pinned: [],
      collapsed: new Set(),
    })
    expect(bandCells(layout.unpinned).map((cell) => [cell.band?.label ?? null, cell.span])).toEqual(
      [
        ['Optimizer', 3],
        [null, 1],
      ],
    )
  })

  it('moves a pinned column to the left zone with its breadcrumb and back on unpin', () => {
    const pinned = layoutGrid(built, variant, {
      visible: all,
      pinned: ['params.optim.lr'],
      collapsed: new Set(),
    })
    expect(pinned.pinned.map((item) => (item.kind === 'column' ? item.headerLabel : ''))).toEqual([
      'Variant',
      'Optimizer › LR',
    ])
    expect(pinned.unpinned.map((item) => item.id)).not.toContain('params.optim.lr')
    const unpinned = layoutGrid(built, variant, { visible: all, pinned: [], collapsed: new Set() })
    const ids = unpinned.unpinned.map((item) => item.id)
    expect(ids.indexOf('params.optim.lr')).toBe(ids.indexOf('params.optim.batch_size') - 1)
  })

  it('collapses a group to a placeholder counting its visible columns, independent of hiding', () => {
    const visible = (id: string) => id !== 'metrics.eval.lpips'
    const collapsed = layoutGrid(built, variant, {
      visible,
      pinned: [],
      collapsed: new Set(['group:metrics.eval']),
    })
    const placeholder = collapsed.unpinned.find((item) => item.kind === 'collapsed')
    expect(placeholder).toMatchObject({ groupId: 'group:metrics.eval', visibleCount: 2 })
    expect(collapsed.unpinned.some((item) => item.id === 'metrics.eval.fid')).toBe(false)
    const expanded = layoutGrid(built, variant, { visible, pinned: [], collapsed: new Set() })
    expect(
      expanded.unpinned.filter((item) => item.id.startsWith('metrics.eval')).map((item) => item.id),
    ).toEqual(['metrics.eval.fid', 'metrics.eval.clip'])
    // A collapsed group whose columns are all hidden does not render.
    const empty = layoutGrid(built, variant, {
      visible: (id) => !id.startsWith('metrics.eval'),
      pinned: [],
      collapsed: new Set(['group:metrics.eval']),
    })
    expect(empty.unpinned.some((item) => item.kind === 'collapsed')).toBe(false)
  })
})
