import { BACKEND_API_MAJOR, type BackendCapabilities } from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import type { BackendReleaseStore } from '../distribution/release-store.js'
import { activatePreparedRelease } from './activation.js'

const capabilities: BackendCapabilities = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: false,
}
const entry = (name: string, release: string, revision: string) => ({
  name,
  manifest: {
    version: 1 as const,
    release,
    revision,
    artifactSha256: 'a'.repeat(64),
    platform: process.platform,
    arch: process.arch,
    nodeRange: '>=20.19 <23',
    createdAt: '2026-08-26T17:00:00.000Z',
  },
})
const metadata = (host: string, release: string, revision: string) => ({
  host,
  release,
  revision,
  apiMajor: BACKEND_API_MAJOR,
  instanceEpoch: '9c64885c-6671-4eb5-9648-d03e04987464',
  ready: true,
  capabilities,
})

describe('activatePreparedRelease', () => {
  it('restores and verifies known-good when new readiness has the wrong Host', async () => {
    const old = entry('6.0.0-old', '6.0.0', 'old')
    const fresh = entry('6.1.0-new', '6.1.0', 'new')
    let current = old
    let previous: typeof old | null = null
    const store = {
      status: vi.fn(async () => ({ current, previous })),
      activate: vi.fn(async (name: string) => {
        previous = current
        current = name === fresh.name ? fresh : old
        return { current, previous }
      }),
    } as unknown as BackendReleaseStore
    const daemon = {
      stop: vi.fn(async () => ({ outcome: 'stopped' })),
      start: vi.fn(async () => ({ outcome: 'started' })),
    }
    const probe = vi
      .fn()
      .mockResolvedValueOnce(metadata('wrong-host', '6.1.0', 'new'))
      .mockResolvedValueOnce(metadata('host-a', '6.0.0', 'old'))
    const result = await activatePreparedRelease({
      store,
      targetName: fresh.name,
      expected: { host: 'host-a', release: '6.1.0', revision: 'new' },
      daemon,
      probe,
    })
    expect(result.outcome).toBe('rolled_back')
    expect(result.current).toBe(old.name)
    expect(daemon.stop).toHaveBeenCalledTimes(2)
    expect(daemon.start).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['wrong revision', metadata('host-a', '6.1.0', 'wrong')],
    ['readiness timeout', new Error('timeout')],
  ])('rolls back when new activation has %s', async (_name, failure) => {
    const old = entry('6.0.0-old', '6.0.0', 'old')
    const fresh = entry('6.1.0-new', '6.1.0', 'new')
    let current = old
    let previous: typeof old | null = null
    const store = {
      status: async () => ({ current, previous }),
      activate: async (name: string) => {
        previous = current
        current = name === fresh.name ? fresh : old
        return { current, previous }
      },
    } as unknown as BackendReleaseStore
    const probe = vi.fn(async () => {
      if (probe.mock.calls.length === 1) {
        if (failure instanceof Error) throw failure
        return failure
      }
      return metadata('host-a', '6.0.0', 'old')
    })
    const result = await activatePreparedRelease({
      store,
      targetName: fresh.name,
      expected: { host: 'host-a', release: '6.1.0', revision: 'new' },
      daemon: {
        stop: async () => ({ outcome: 'stopped' }),
        start: async () => ({ outcome: 'started' }),
      },
      probe,
    })
    expect(result.outcome).toBe('rolled_back')
    expect(result.current).toBe(old.name)
  })

  it('reports rollback_failed and retains installed known-good bytes when old health also fails', async () => {
    const old = entry('6.0.0-old', '6.0.0', 'old')
    const fresh = entry('6.1.0-new', '6.1.0', 'new')
    let current = old
    let previous: typeof old | null = null
    const store = {
      status: async () => ({ current, previous }),
      activate: async (name: string) => {
        previous = current
        current = name === fresh.name ? fresh : old
        return { current, previous }
      },
    } as unknown as BackendReleaseStore
    const result = await activatePreparedRelease({
      store,
      targetName: fresh.name,
      expected: { host: 'host-a', release: '6.1.0', revision: 'new' },
      daemon: {
        stop: async () => ({ outcome: 'stopped' }),
        start: async () => ({ outcome: 'started' }),
      },
      probe: async () => {
        throw new Error('timeout')
      },
    })
    expect(result.outcome).toBe('rollback_failed')
    expect(result.rollback?.healthy).toBe(false)
    expect(result.current).toBe(old.name)
  })

  it('reports running metadata equal to the installed target', async () => {
    const fresh = entry('6.1.0-new', '6.1.0', 'new')
    let current: null | typeof fresh = null
    const previous: null | typeof fresh = null
    const store = {
      status: async () => ({ current, previous }),
      activate: async () => {
        current = fresh
        return { current, previous }
      },
    } as unknown as BackendReleaseStore
    const result = await activatePreparedRelease({
      store,
      targetName: fresh.name,
      expected: { host: 'host-a', release: '6.1.0', revision: 'new' },
      daemon: {
        stop: async () => ({ outcome: 'stopped' }),
        start: async () => ({ outcome: 'started' }),
      },
      probe: async () => metadata('host-a', '6.1.0', 'new'),
    })
    expect(result).toMatchObject({
      outcome: 'activated',
      current: fresh.name,
      target: { healthy: true },
    })
  })

  it('returns a redacted stage code when readiness throws private operational detail', async () => {
    const fresh = entry('6.1.0-new', '6.1.0', 'new')
    let current: null | typeof fresh = null
    const store = {
      status: async () => ({ current, previous: null }),
      activate: async () => {
        current = fresh
        return { current, previous: null }
      },
    } as unknown as BackendReleaseStore
    const result = await activatePreparedRelease({
      store,
      targetName: fresh.name,
      expected: { host: 'host-a', release: '6.1.0', revision: 'new' },
      daemon: {
        stop: async () => ({ outcome: 'stopped' }),
        start: async () => ({ outcome: 'started' }),
      },
      probe: async () => {
        throw new Error('Bearer private-token at /private/cluster/path')
      },
    })
    expect(result.target.error).toBe('readiness_failed')
    expect(JSON.stringify(result)).not.toContain('private-token')
    expect(JSON.stringify(result)).not.toContain('/private/cluster/path')
  })

  it('does not switch the release pointer when the live daemon cannot stop', async () => {
    const old = entry('6.0.0-old', '6.0.0', 'old')
    const activate = vi.fn()
    const store = {
      status: async () => ({ current: old, previous: null }),
      activate,
    } as unknown as BackendReleaseStore
    const result = await activatePreparedRelease({
      store,
      targetName: '6.1.0-new',
      expected: { host: 'host-a', release: '6.1.0', revision: 'new' },
      daemon: {
        stop: async () => {
          throw new Error('private supervisor failure')
        },
        start: vi.fn(),
      },
      probe: vi.fn(),
    })
    expect(result).toMatchObject({
      outcome: 'activation_failed',
      current: old.name,
      target: { error: 'stop_failed' },
    })
    expect(activate).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private supervisor failure')
  })
})
