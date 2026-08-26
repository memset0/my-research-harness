import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBackendTtydChecksum,
  fetchBoundedBackendTtydBytes,
  MAX_TTYD_CHECKSUM_BYTES,
  MAX_TTYD_DOWNLOAD_BYTES,
} from './terminal-binary.js'

describe('Backend ttyd download integrity', () => {
  it('selects the exact asset from the official SHA256SUMS shape', async () => {
    const expected = 'a'.repeat(64)
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(null, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    fetchImpl.mockResolvedValueOnce(
      new Response(`${'b'.repeat(64)}  ttyd.aarch64\n${expected}  ttyd.x86_64\n`),
    )
    await expect(
      fetchBackendTtydChecksum(
        'https://github.com/tsl0922/ttyd/releases/download/1.7.7/SHA256SUMS',
        'ttyd.x86_64',
        fetchImpl,
      ),
    ).resolves.toBe(expected)
  })

  it('fails closed when checksums are missing, malformed, or oversized', async () => {
    for (const response of [
      () => new Response(`${'a'.repeat(64)}  ttyd.aarch64\n`),
      () => new Response('not a checksum'),
      () =>
        new Response('x', {
          headers: { 'content-length': String(MAX_TTYD_CHECKSUM_BYTES + 1) },
        }),
    ]) {
      await expect(
        fetchBackendTtydChecksum('https://example.test/SHA256SUMS', 'ttyd.x86_64', async () =>
          response(),
        ),
      ).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' })
    }
  })

  it('bounds binary bytes before buffering and preserves verified bytes', async () => {
    const bytes = Buffer.from('synthetic ttyd bytes')
    await expect(
      fetchBoundedBackendTtydBytes(
        'https://example.test/ttyd.x86_64',
        async () => new Response(bytes),
      ),
    ).resolves.toEqual(bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toMatch(/^[a-f0-9]{64}$/)

    await expect(
      fetchBoundedBackendTtydBytes(
        'https://example.test/ttyd.x86_64',
        async () =>
          new Response('x', { headers: { 'content-length': String(MAX_TTYD_DOWNLOAD_BYTES + 1) } }),
      ),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' })
  })
})
