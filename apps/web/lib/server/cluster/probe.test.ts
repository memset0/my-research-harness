// @vitest-environment node
import { type NodeDefinition, parseNodes } from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import {
  buildOverview,
  createProbeCache,
  type ProbeResult,
  parseProbeOutput,
  runProbe,
} from './probe'

const CANNED = [
  '0, GPU-a, NVIDIA H200, 1024, 143771, 5',
  '1, GPU-b, NVIDIA H200, 0, 143771, [N/A]',
  '__MEMON_APPS__',
  'GPU-a',
  'GPU-a',
]
const fakeVia = `printf '%s\\n' ${CANNED.map((line) => `'${line}'`).join(' ')}; :`

function nodes(extra: Record<string, unknown> = {}): NodeDefinition[] {
  return parseNodes({
    schema_version: 1,
    nodes: {
      fake: {
        cluster: 'cluster-a',
        gpus: 2,
        allocatable_gpus: [1],
        available_until: '2099-01-01T00:00:00Z',
        via: fakeVia,
      },
      old: {
        cluster: 'cluster-b',
        available_until: '2000-01-01T00:00:00Z',
        ssh: { target: 'user@login.example' },
      },
      ...extra,
    },
  })
}

describe('parseProbeOutput', () => {
  it('counts compute processes per GPU and tolerates N/A metrics', () => {
    const gpus = parseProbeOutput(`${CANNED.join('\n')}\n`)
    expect(gpus.map((gpu) => [gpu.index, gpu.processes, gpu.utilizationPct])).toEqual([
      [0, 2, 5],
      [1, 0, null],
    ])
  })

  it('rejects output without GPUs or the apps marker', () => {
    expect(() => parseProbeOutput('garbage')).toThrow(/compute-apps/)
    expect(() => parseProbeOutput('__MEMON_APPS__\n')).toThrow(/no GPUs/)
  })
})

describe('runProbe', () => {
  it('probes through the via transport', async () => {
    const result = await runProbe(nodes().find((node) => node.id === 'fake')!)
    expect(result.ok && result.gpus.map((gpu) => gpu.processes)).toEqual([2, 0])
  })

  it('reports a timeout as a failed probe without leaking the via line', async () => {
    const [slow] = parseNodes({
      schema_version: 1,
      nodes: { slow: { available_until: '2099-01-01T00:00:00Z', via: 'sleep 5;' } },
    })
    const result = await runProbe(slow!, 200)
    expect(result).toMatchObject({ ok: false, error: 'probe timed out after 0 s' })
  })

  it('redacts transport details from errors', async () => {
    const [bad] = parseNodes({
      schema_version: 1,
      nodes: {
        bad: { available_until: '2099-01-01T00:00:00Z', via: 'echo secret-via >&2; exit 3;' },
      },
    })
    const result = await runProbe(bad!)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('echo secret-via')
  })
})

describe('createProbeCache', () => {
  const ok = (at: number): ProbeResult => ({ ok: true, at, gpus: [] })

  it('reuses results within the TTL unless refreshed, and dedupes in-flight probes', async () => {
    let clock = 1_000
    const run = vi.fn(async () => ok(clock))
    const probe = createProbeCache(run, { ttlMs: 45_000, now: () => clock })
    const [node] = nodes()
    await Promise.all([probe(node!, false), probe(node!, false)])
    expect(run).toHaveBeenCalledTimes(1)
    clock += 10_000
    expect((await probe(node!, false)).at).toBe(1_000)
    expect(run).toHaveBeenCalledTimes(1)
    await probe(node!, true)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('never runs more probes at once than the concurrency cap', async () => {
    let active = 0
    let peak = 0
    const run = async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      return ok(0)
    }
    const probe = createProbeCache(run, { concurrency: 2 })
    const many = parseNodes({
      schema_version: 1,
      nodes: Object.fromEntries(
        ['a', 'b', 'c', 'd', 'e'].map((id) => [
          id,
          { available_until: '2099-01-01T00:00:00Z', via: 'x' },
        ]),
      ),
    })
    await Promise.all(many.map((node) => probe(node, false)))
    expect(peak).toBe(2)
  })
})

describe('buildOverview', () => {
  it('groups by cluster, marks allocatable GPUs, skips expired nodes and hides connection details', async () => {
    const probe = vi.fn(async (node: NodeDefinition) => runProbe(node))
    const overview = await buildOverview(nodes(), probe, {
      refresh: false,
      nowMs: Date.parse('2026-11-25T00:00:00Z'),
      tasks: null,
    })
    expect(probe).toHaveBeenCalledTimes(1)
    const [a, b] = overview.clusters
    expect(a?.cluster).toBe('cluster-a')
    expect(a?.nodes[0]?.gpu_rows.map((gpu) => [gpu.index, gpu.allocatable, gpu.processes])).toEqual(
      [
        [0, false, 2],
        [1, true, 0],
      ],
    )
    expect(b?.nodes[0]).toMatchObject({ id: 'old', state: 'expired', gpu_rows: [] })
    expect(overview.tasks).toEqual({ available: false, items: [] })
    const body = JSON.stringify(overview)
    expect(body).not.toContain('login.example')
    expect(body).not.toContain('printf')
  })
})
