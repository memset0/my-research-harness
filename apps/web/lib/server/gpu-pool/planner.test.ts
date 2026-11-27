// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { type PoolNode, planGrants } from './planner'
import type { Ticket } from './types'

const NOW = Date.parse('2026-12-01T00:00:00Z')
const DAY = 24 * 3600 * 1000

function ticket(id: string, over: Partial<Ticket> = {}): Ticket {
  return {
    id,
    project: 'project-a',
    gpus: 2,
    wholeNode: false,
    gpuType: null,
    durationS: 3600,
    label: null,
    run: null,
    status: 'QUEUED',
    node: null,
    grantedGpus: [],
    requestedAt: '',
    requestedAtMs: 0,
    grantedAt: null,
    expiresAt: null,
    expiresAtMs: null,
    endedAt: null,
    reason: null,
    owner: null,
    forced: null,
    syncState: null,
    syncCommit: null,
    syncOutput: null,
    runStartedAt: null,
    pushState: null,
    pushCommit: null,
    pushOutput: null,
    unrecordedRuns: [],
    ...over,
  }
}

const idle = (index: number) => ({ index, memoryUsedMib: 0, processes: 0 })
const busy = (index: number) => ({ index, memoryUsedMib: 40_000, processes: 1 })

function node(id: string, over: Partial<PoolNode> = {}): PoolNode {
  return {
    id,
    cluster: 'cluster-a',
    gpuType: 'H200',
    allocation: 'gpus',
    allocatable: [0, 1, 2, 3],
    availableUntilMs: NOW + 10 * DAY,
    snapshot: [idle(0), idle(1), idle(2), idle(3)],
    ...over,
  }
}

const plan = (
  queue: Ticket[],
  nodes: PoolNode[],
  extra: { held?: Map<string, Set<number>>; dirty?: Set<string> } = {},
) =>
  planGrants({
    queue,
    nodes,
    held: extra.held ?? new Map(),
    dirty: extra.dirty ?? new Set(),
    nowMs: NOW,
  })

describe('planGrants', () => {
  it('grants only on nodes of the clusters the ticket may use', () => {
    const nodes = [node('node-01', { cluster: 'cluster-b' }), node('node-02')]
    const only = (clusters: string[]) => () => new Set(clusters)
    const restricted = planGrants({
      queue: [ticket('T0001')],
      nodes,
      held: new Map(),
      dirty: new Set(),
      nowMs: NOW,
      clustersOf: only(['cluster-a']),
    })
    expect(restricted.grants).toEqual([{ id: 'T0001', node: 'node-02', gpus: [0, 1] }])

    const busyOnly = planGrants({
      queue: [ticket('T0001')],
      nodes: [
        nodes[0] as PoolNode,
        node('node-02', { snapshot: [busy(0), busy(1), busy(2), busy(3)] }),
      ],
      held: new Map(),
      dirty: new Set(),
      nowMs: NOW,
      clustersOf: only(['cluster-a']),
    })
    expect(busyOnly).toEqual({ grants: [], failures: [] })

    const none = planGrants({
      queue: [ticket('T0001')],
      nodes,
      held: new Map(),
      dirty: new Set(),
      nowMs: NOW,
      clustersOf: only(['cluster-z']),
    })
    expect(none.grants).toEqual([])
    expect(none.failures[0]?.reason).toMatch(/project project-a may use clusters cluster-z/)
  })

  it('skips busy, held and dirty GPUs and takes the lowest free ones', () => {
    const result = plan(
      [ticket('T0001')],
      [node('node-01', { snapshot: [busy(0), idle(1), idle(2), idle(3)] })],
      {
        held: new Map([['node-01', new Set([1])]]),
        dirty: new Set(['node-01:2']),
      },
    )
    expect(result.grants).toEqual([])
    const ok = plan(
      [ticket('T0001')],
      [node('node-01', { snapshot: [busy(0), idle(1), idle(2), idle(3)] })],
    )
    expect(ok.grants).toEqual([{ id: 'T0001', node: 'node-01', gpus: [1, 2] }])
  })

  it('grants whole-node nodes only whole', () => {
    const whole = node('node-01', { allocation: 'node' })
    expect(plan([ticket('T0001')], [whole]).grants).toEqual([])
    expect(plan([ticket('T0001')], [whole]).failures[0]?.reason).toMatch(/no registered node/)
    expect(plan([ticket('T0002', { gpus: null, wholeNode: true })], [whole]).grants).toEqual([
      { id: 'T0002', node: 'node-01', gpus: [0, 1, 2, 3] },
    ])
  })

  it('matches GPU type case-insensitively and fails unknown types', () => {
    expect(plan([ticket('T0001', { gpuType: 'h200' })], [node('node-01')]).grants).toHaveLength(1)
    const result = plan([ticket('T0002', { gpuType: 'A100' })], [node('node-01')])
    expect(result.failures).toEqual([
      { id: 'T0002', reason: 'no registered node can provide 2 GPU(s) of type A100' },
    ])
  })

  it('keeps tickets queued when the node expires before the duration ends or cannot be probed', () => {
    const short = node('node-01', { availableUntilMs: NOW + 2 * 3600 * 1000 })
    expect(plan([ticket('T0001', { durationS: 6 * 3600 })], [short])).toEqual({
      grants: [],
      failures: [],
    })
    expect(plan([ticket('T0001')], [node('node-01', { snapshot: null })])).toEqual({
      grants: [],
      failures: [],
    })
  })

  it('grants greedily in queue order without double-booking', () => {
    const result = plan(
      [ticket('T0001', { gpus: 3 }), ticket('T0002', { gpus: 2 }), ticket('T0003', { gpus: 1 })],
      [node('node-01')],
    )
    expect(result.grants).toEqual([
      { id: 'T0001', node: 'node-01', gpus: [0, 1, 2] },
      { id: 'T0003', node: 'node-01', gpus: [3] },
    ])
  })

  it('respects allocatable subsets', () => {
    const subset = node('node-01', {
      allocatable: [5, 6, 7],
      snapshot: [busy(0), idle(5), idle(6), idle(7)],
    })
    expect(plan([ticket('T0001', { gpus: 3 })], [subset]).grants).toEqual([
      { id: 'T0001', node: 'node-01', gpus: [5, 6, 7] },
    ])
    expect(plan([ticket('T0002', { gpus: 4 })], [subset]).failures).toHaveLength(1)
  })
})
