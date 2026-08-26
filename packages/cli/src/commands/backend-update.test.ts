import { describe, expect, it, vi } from 'vitest'
import { probeBackendReadiness } from './backend-update.js'

describe('Backend update readiness polling', () => {
  it('retries bounded startup failures and supports an IPv6 loopback listener', async () => {
    let clock = 0
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(new Response('starting', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ready: true }))

    await expect(
      probeBackendReadiness({
        address: '::1',
        port: 3738,
        token: 'a'.repeat(32),
        timeoutMs: 100,
        intervalMs: 10,
        fetchImpl,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds
        },
      }),
    ).resolves.toEqual({ ready: true })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('http://[::1]:3738/api/backend/v1/meta')
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${'a'.repeat(32)}`,
    )
  })

  it('times out with a redacted bounded error', async () => {
    let clock = 0
    const secret = 'private-backend-token'
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error(`connection leaked ${secret}`)
    })
    let failure: unknown
    try {
      await probeBackendReadiness({
        address: '127.0.0.1',
        port: 3738,
        token: secret,
        timeoutMs: 20,
        intervalMs: 5,
        fetchImpl,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds
        },
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('Backend readiness failed: unreachable')
    expect((failure as Error).message).not.toContain(secret)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })
})
