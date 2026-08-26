// @vitest-environment node
import { BackendTtydInstallError } from '@memon/backend'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../../lib/server/standalone-terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/server/standalone-terminal')>()),
  standaloneTerminal: vi.fn(),
}))

import { getRuntime } from '../../../../lib/runtime'
import { standaloneTerminal } from '../../../../lib/server/standalone-terminal'
import { POST } from './route'

const install = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({ config: {} } as never)
  vi.mocked(standaloneTerminal).mockReturnValue({ install } as never)
})

describe('POST /api/terminal/install shared SHA256SUMS adapter', () => {
  it('returns successful and already-present results', async () => {
    install.mockResolvedValue({ ok: true, version: '1.7.7', alreadyPresent: true, durationMs: 0 })
    const response = await POST()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, alreadyPresent: true })
  })

  it.each([
    ['DOWNLOAD_FAILED', 502],
    ['INTEGRITY_FAILED', 502],
    ['NOT_AUTOFETCHABLE', 501],
    ['EXEC_FAILED', 500],
  ] as const)('maps %s safely', async (code, status) => {
    install.mockRejectedValue(new BackendTtydInstallError(code, 'safe failure'))
    const response = await POST()
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ error: { code } })
  })
})
