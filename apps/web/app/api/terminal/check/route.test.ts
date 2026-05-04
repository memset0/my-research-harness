// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../lib/terminal/binary', () => ({
  probeTtyd: vi.fn(),
}))

import { GET } from './route'
import { probeTtyd } from '../../../../lib/terminal/binary'

describe('GET /api/terminal/check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with available=true when probe succeeds', async () => {
    vi.mocked(probeTtyd).mockResolvedValue({
      available: true,
      version: '1.7.7',
      source: 'cached',
      path: '/fake/.cache/memon/bin/ttyd-1.7.7-x86_64',
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      available: true,
      version: '1.7.7',
      source: 'cached',
    })
  })

  it('returns 200 with downloadable hint when probe says missing on linux', async () => {
    vi.mocked(probeTtyd).mockResolvedValue({
      available: false,
      downloadable: true,
      suggestion: 'POST /api/terminal/install',
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available).toBe(false)
    expect(body.downloadable).toBe(true)
    expect(body.suggestion).toMatch(/install/i)
  })

  it('returns 200 with manual hint on darwin', async () => {
    vi.mocked(probeTtyd).mockResolvedValue({
      available: false,
      downloadable: false,
      suggestion: 'brew install ttyd',
    })
    const res = await GET()
    const body = await res.json()
    expect(body.available).toBe(false)
    expect(body.downloadable).toBe(false)
    expect(body.suggestion).toMatch(/brew/)
  })
})
