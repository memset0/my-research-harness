// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../../lib/server/standalone-terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/server/standalone-terminal')>()),
  standaloneTerminal: vi.fn(),
}))

import { getRuntime } from '../../../../lib/runtime'
import { standaloneTerminal } from '../../../../lib/server/standalone-terminal'
import { GET } from './route'

const check = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({ config: {} } as never)
  vi.mocked(standaloneTerminal).mockReturnValue({ check } as never)
})

describe('GET /api/terminal/check shared adapter', () => {
  it.each([
    { available: true, version: '1.7.7', source: 'cached' },
    { available: false, downloadable: true, suggestion: 'POST /api/terminal/install' },
    { available: false, downloadable: false, suggestion: 'brew install ttyd' },
  ])('returns the shared probe result', async (payload) => {
    check.mockResolvedValue(payload)
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(payload)
  })
})
