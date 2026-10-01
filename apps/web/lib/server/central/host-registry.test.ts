// @vitest-environment node

import {
  BACKEND_API_MAJOR,
  type BackendCapabilities,
  type BackendMetadata,
  type CentralConfig,
} from '@memon/core'
import { describe, expect, it } from 'vitest'
import { CentralHostRegistry, HostRoutingError } from './host-registry'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const EPOCH = '9c64885c-6671-4eb5-9648-d03e04987464'

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

const config: CentralConfig = {
  bindAddr: '127.0.0.1',
  bindPort: 3737,
  hosts: [
    {
      id: 'host-a',
      tokens: { current: TOKEN_A },
      transport: {
        kind: 'url',
        baseUrl: 'https://backend-a.example.test',
        allowInsecureHttp: false,
      },
    },
    {
      id: 'host-b',
      tokens: { current: TOKEN_B },
      transport: {
        kind: 'url',
        baseUrl: 'https://backend-b.example.test',
        allowInsecureHttp: false,
      },
    },
  ],
}

function metadata(host: string, release = '6.2.0'): BackendMetadata {
  return {
    host: host as BackendMetadata['host'],
    release: release as BackendMetadata['release'],
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef' as BackendMetadata['revision'],
    instanceEpoch: EPOCH as BackendMetadata['instanceEpoch'],
    ready: true,
    capabilities,
  }
}

describe('CentralHostRegistry', () => {
  it('starts every configured Host as connecting without exposing tokens', () => {
    const registry = new CentralHostRegistry(config, { centralRelease: '6.2.1' })
    const serialized = JSON.stringify(registry.listAvailability())
    expect(registry.listAvailability().map((host) => host.state)).toEqual([
      'connecting',
      'connecting',
    ])
    expect(serialized).not.toContain(TOKEN_A)
    expect(serialized).not.toContain(TOKEN_B)
  })

  it.each([
    ['6.2.9', 'online'],
    ['6.1.0', 'update_available'],
    ['6.0.0', 'upgrade_required'],
    ['6.3.0', 'central_update_required'],
    ['7.0.0', 'filesystem_migration_required'],
  ] as const)('classifies Backend %s as %s', (release, expected) => {
    const registry = new CentralHostRegistry(config, {
      centralRelease: '6.2.1',
      now: () => new Date('2026-08-26T16:00:00Z'),
    })
    expect(registry.acceptMetadata('host-a', metadata('host-a', release)).state).toBe(expected)
  })

  it('distinguishes malformed metadata, identity mismatch, auth failure, and offline', () => {
    const registry = new CentralHostRegistry(config, { centralRelease: '6.2.0' })
    expect(registry.acceptMetadata('host-a', { bad: true }).state).toBe('misconfigured')
    expect(registry.acceptMetadata('host-a', metadata('host-b')).state).toBe('identity_mismatch')
    expect(registry.markFailure('host-a', 'authentication_failed', 'token rejected').state).toBe(
      'authentication_failed',
    )
    expect(registry.markFailure('host-a', 'offline', 'connect failed').state).toBe('offline')
  })

  it('routes only usable Hosts and never guesses an unknown Host', () => {
    const registry = new CentralHostRegistry(config, { centralRelease: '6.2.0' })
    expect(() => registry.requireUsableHost('host-a')).toThrow(HostRoutingError)
    expect(() => registry.requireUsableHost('missing')).toThrowError(
      expect.objectContaining({ state: 'unknown_host' }),
    )
    registry.acceptMetadata('host-a', metadata('host-a'))
    expect(registry.requireUsableHost('host-a').id).toBe('host-a')
  })

  it('keeps duplicate Project names distinct by Host and clears stale Host payloads', () => {
    const registry = new CentralHostRegistry(config, { centralRelease: '6.2.0' })
    registry.acceptMetadata('host-a', metadata('host-a'))
    registry.acceptMetadata('host-b', metadata('host-b'))
    registry.setLiveProjects('host-a', ['project-x'])
    registry.setLiveProjects('host-b', ['project-x'])
    expect(registry.listLiveProjects()).toEqual([
      { host: 'host-a', project: 'project-x' },
      { host: 'host-b', project: 'project-x' },
    ])

    registry.markFailure('host-a', 'offline', 'transport dropped')
    expect(registry.listLiveProjects()).toEqual([{ host: 'host-b', project: 'project-x' }])
    expect(registry.listAvailability().find((host) => host.host === 'host-a')?.state).toBe(
      'offline',
    )
  })

  it('rejects duplicate Projects from one Backend instead of silently merging', () => {
    const registry = new CentralHostRegistry(config, { centralRelease: '6.2.0' })
    registry.acceptMetadata('host-a', metadata('host-a'))
    expect(() => registry.setLiveProjects('host-a', ['project-x', 'project-x'])).toThrow(
      /duplicate Project/,
    )
  })

  it('stores only safe Host-qualified Project summary metadata', () => {
    const registry = new CentralHostRegistry(config, { centralRelease: '6.2.0' })
    registry.acceptMetadata('host-a', metadata('host-a'))
    registry.setLiveProjectSummaries('host-a', [
      {
        host: 'host-a',
        project: 'project-x',
        label: 'Project X',
        description: 'Synthetic Project',
      },
    ])
    expect(registry.listLiveProjects()).toEqual([
      {
        host: 'host-a',
        project: 'project-x',
        label: 'Project X',
        description: 'Synthetic Project',
      },
    ])
    expect(() =>
      registry.setLiveProjectSummaries('host-a', [
        { host: 'host-a', project: 'project-x', root: '/srv/private' },
      ]),
    ).toThrow()
    expect(JSON.stringify(registry.listLiveProjects())).not.toContain('/srv/private')
  })

  it('bounds and normalizes diagnostics without leaking multiline raw output', () => {
    const registry = new CentralHostRegistry(config, { centralRelease: '6.2.0' })
    const result = registry.markFailure(
      'host-a',
      'offline',
      `line one\nline two token=${TOKEN_A} ${'x'.repeat(600)}`,
    )
    expect(result.diagnostic).not.toContain('\n')
    expect(result.diagnostic).not.toContain(TOKEN_A)
    expect(result.diagnostic).toContain('[REDACTED]')
    expect(result.diagnostic?.length).toBeLessThanOrEqual(512)
  })
})
