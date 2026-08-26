// @vitest-environment node

import type { HostAvailability } from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHosts } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchHosts', () => {
  it('fetches the safe Host availability response', async () => {
    const host = {
      host: 'host-a',
      state: 'offline',
      diagnostic: 'Backend is unavailable',
      lastSuccessfulCheckAt: null,
      centralRelease: '6.0.0',
      backendRelease: null,
      backendRevision: null,
      capabilities: null,
    } as HostAvailability
    const fetchMock = vi.fn(async () => Response.json({ hosts: [host] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchHosts()).resolves.toEqual({ hosts: [host] })
    expect(fetchMock).toHaveBeenCalledWith('/api/hosts', undefined)
  })
})
