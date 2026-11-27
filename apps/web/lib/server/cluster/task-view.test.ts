// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { HerdrTerminal } from '@/lib/server/gpu-pool/herdr'
import { ticketOfTerminal } from '@/lib/server/gpu-pool/herdr'
import type { Ticket } from '@/lib/server/gpu-pool/types'
import { mapTasks, RECENT_MS, visibilityFor } from './task-view'

const NOW = Date.parse('2026-12-01T12:00:00Z')

function ticket(id: string, over: Partial<Ticket> = {}): Ticket {
  return {
    id,
    project: 'project-a',
    gpus: 2,
    wholeNode: false,
    gpuType: null,
    durationS: 3600,
    label: 'sweep',
    run: null,
    status: 'GRANTED',
    node: 'node-01',
    grantedGpus: [0, 1],
    requestedAt: '2026-12-01T11:00:00Z',
    requestedAtMs: 0,
    grantedAt: '2026-12-01T11:30:00Z',
    expiresAt: '2026-12-01T12:30:00Z',
    expiresAtMs: 0,
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

const terminals = new Map<string, HerdrTerminal[]>([
  ['T0001', [{ address: 'node-01/t3', name: 't0001-main', state: 'live', exitCode: null }]],
])

describe('mapTasks', () => {
  it('maps granted, queued and recently ended tickets with their tasks', () => {
    const items = mapTasks(
      [
        ticket('T0001'),
        ticket('T0002', { status: 'QUEUED', node: null, grantedGpus: [], grantedAt: null }),
        ticket('T0003', { status: 'RELEASED', endedAt: '2026-12-01T10:00:00Z' }),
        ticket('T0004', {
          status: 'EXPIRED',
          endedAt: new Date(NOW - RECENT_MS - 1000).toISOString(),
        }),
      ],
      terminals,
      visibilityFor('all'),
      NOW,
    )
    expect(items.map((item) => [item.id, item.state, item.status])).toEqual([
      ['T0001', 'RUNNING', 'GRANTED'],
      ['T0002', 'QUEUED', 'QUEUED'],
      ['T0003', 'ENDED', 'RELEASED'],
    ])
    expect(items[0]).toMatchObject({
      redacted: false,
      project: 'project-a',
      label: 'sweep',
      gpus: [0, 1],
      expires_at: '2026-12-01T12:30:00Z',
      tasks: [{ name: 'main', state: 'live', exit_code: null }],
    })
  })

  it('shows an admin only its granted projects, and others as anonymous occupied bars', () => {
    const visible = visibilityFor([{ host: 'central', project: 'project-a' }])
    const items = mapTasks(
      [
        ticket('T0001'),
        ticket('T0002', { project: 'project-b', label: 'secret' }),
        ticket('T0003', { project: 'project-b', status: 'QUEUED', grantedAt: null }),
        ticket('T0004', { project: 'central/project-a', status: 'QUEUED', grantedAt: null }),
      ],
      new Map([
        ...terminals,
        ['T0002', [{ address: 'x', name: 't0002-main', state: 'live', exitCode: null }]],
      ]),
      visible,
      NOW,
    )
    expect(items.map((item) => [item.id, item.redacted])).toEqual([
      ['T0001', false],
      ['occupied', true],
      ['T0004', false],
    ])
    expect(items[1]).toMatchObject({
      project: null,
      label: null,
      reason: null,
      requested_at: null,
      tasks: [],
      node: 'node-01',
      gpus: [0, 1],
    })
    expect(JSON.stringify(items)).not.toMatch(/project-b|secret/)
  })
})

describe('ticketOfTerminal', () => {
  it('reads the ticket id from terminal names', () => {
    expect(ticketOfTerminal('tk_7h3q9m2xw4ra-main')).toBe('tk_7h3q9m2xw4ra')
    expect(ticketOfTerminal('t0012-main')).toBeNull()
    expect(ticketOfTerminal('tk_short-main')).toBeNull()
    expect(ticketOfTerminal('memon-probe')).toBeNull()
    expect(ticketOfTerminal(null)).toBeNull()
  })
})
