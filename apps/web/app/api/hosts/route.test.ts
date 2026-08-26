// @vitest-environment node

import type { HostAvailability } from '@memon/core'
import { describe, expect, it } from 'vitest'
import { buildHostsResponse } from './route'

describe('GET /api/hosts response', () => {
  it('contains only safe Host availability DTOs and clones the input', () => {
    const host = {
      host: 'host-a',
      state: 'offline',
      diagnostic: 'Backend tunnel is unavailable',
      lastSuccessfulCheckAt: null,
      centralRelease: '6.0.0',
      backendRelease: null,
      backendRevision: null,
      capabilities: null,
      label: 'Cluster A',
    } as HostAvailability & { label: string }
    const response = buildHostsResponse([host])
    expect(response).toEqual({ hosts: [host] })
    expect(response.hosts[0]).not.toBe(host)
    expect(JSON.stringify(response)).not.toContain('token')
    expect(JSON.stringify(response)).not.toContain('known_hosts')
  })
})
