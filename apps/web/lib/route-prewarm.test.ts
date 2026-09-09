// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prewarmRoutes } from './route-prewarm'

const originalFetch = globalThis.fetch

function fakeResponse(status = 200): Response {
  return {
    status,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
})

describe('prewarmRoutes', () => {
  it('GETs /api/projects + 4 sub-paths per project, with Basic auth', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => fakeResponse(200))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await prewarmRoutes({
      host: 'localhost',
      port: 3737,
      projects: [{ name: 'project-a' }, { name: 'project-b' }],
      auth: { username: 'admin', password: 'pw' },
    })

    const calls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(calls).toContain('http://localhost:3737/api/projects')
    for (const project of ['project-a', 'project-b']) {
      for (const sub of ['', '/hypotheses', '/journal', '/reports']) {
        expect(calls).toContain(`http://localhost:3737/p/${project}${sub}`)
      }
    }
    expect(fetchMock).toHaveBeenCalledTimes(9)

    const expectedHeader = `Basic ${Buffer.from('admin:pw', 'utf8').toString('base64')}`
    for (const [, init] of fetchMock.mock.calls) {
      const headers = (init as RequestInit | undefined)?.headers as
        | Record<string, string>
        | undefined
      expect(headers?.authorization).toBe(expectedHeader)
    }
  })

  it('encodes project names containing URL-special characters', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => fakeResponse(200))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await prewarmRoutes({
      host: 'localhost',
      port: 3737,
      projects: [{ name: 'pro ject/x' }],
      auth: { username: 'u', password: 'p' },
    })
    const calls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(calls).toContain('http://localhost:3737/p/pro%20ject%2Fx')
    expect(calls).toContain('http://localhost:3737/p/pro%20ject%2Fx/hypotheses')
  })

  it('does not throw when one fetch rejects', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/journal')) throw new Error('boom')
      return fakeResponse(200)
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(
      prewarmRoutes({
        host: 'localhost',
        port: 3737,
        projects: [{ name: 'p1' }],
        auth: { username: 'u', password: 'p' },
      }),
    ).resolves.toBeUndefined()
  })

  it('logs status and timing for each route', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => fakeResponse(404))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const logSpy = vi.mocked(console.log)
    await prewarmRoutes({
      host: 'h',
      port: 1,
      projects: [{ name: 'x' }],
      auth: { username: 'u', password: 'p' },
    })
    const messages = logSpy.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.startsWith('[prewarm] GET /api/projects -> 404 in'))).toBe(true)
    expect(messages.some((m) => m.startsWith('[prewarm] GET /p/x/journal -> 404 in'))).toBe(true)
  })
})
