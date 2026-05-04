// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../lib/terminal/binary', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/terminal/binary')>(
    '../../../../lib/terminal/binary',
  )
  return {
    ...actual,
    installTtyd: vi.fn(),
  }
})

import { POST } from './route'
import { TtydInstallError, installTtyd } from '../../../../lib/terminal/binary'

describe('POST /api/terminal/install', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('200 on successful install', async () => {
    vi.mocked(installTtyd).mockResolvedValue({
      ok: true,
      version: '1.7.7',
      path: '/c/ttyd-1.7.7-x86_64',
      durationMs: 1234,
    })
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, version: '1.7.7' })
  })

  it('200 alreadyPresent passes through', async () => {
    vi.mocked(installTtyd).mockResolvedValue({
      ok: true,
      version: '1.7.7',
      path: '/c/ttyd',
      alreadyPresent: true,
      durationMs: 0,
    })
    const res = await POST()
    expect(res.status).toBe(200)
    expect((await res.json()).alreadyPresent).toBe(true)
  })

  it('502 DOWNLOAD_FAILED', async () => {
    vi.mocked(installTtyd).mockRejectedValue(
      new TtydInstallError('DOWNLOAD_FAILED', 'network down'),
    )
    const res = await POST()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatchObject({ code: 'DOWNLOAD_FAILED' })
  })

  it('502 INTEGRITY_FAILED', async () => {
    vi.mocked(installTtyd).mockRejectedValue(
      new TtydInstallError('INTEGRITY_FAILED', 'sha mismatch'),
    )
    const res = await POST()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatchObject({ code: 'INTEGRITY_FAILED' })
  })

  it('501 NOT_AUTOFETCHABLE on macOS', async () => {
    vi.mocked(installTtyd).mockRejectedValue(
      new TtydInstallError('NOT_AUTOFETCHABLE', 'use brew'),
    )
    const res = await POST()
    expect(res.status).toBe(501)
    expect((await res.json()).error).toMatchObject({ code: 'NOT_AUTOFETCHABLE' })
  })

  it('500 generic error', async () => {
    vi.mocked(installTtyd).mockRejectedValue(new Error('boom'))
    const res = await POST()
    expect(res.status).toBe(500)
  })
})
