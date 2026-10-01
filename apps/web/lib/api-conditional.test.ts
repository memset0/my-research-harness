// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchHypotheses } from './api'
import { __resetResourceProtocolForTests } from './resource-protocol'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  __resetResourceProtocolForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const body = { project: 'p', entries: [], parseErrors: [], parseWarnings: [] }

function ok(): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      etag: 'W/"v1"',
      'cache-control': 'private, no-cache',
    },
  })
}

function sentHeaders(call: number): Headers {
  return new Headers(fetchMock.mock.calls[call]![1]!.headers)
}

describe('conditional list heartbeats in jsonFetch', () => {
  it('sends If-None-Match and reuses the same data object on 304', async () => {
    fetchMock.mockResolvedValueOnce(ok())
    const first = await fetchHypotheses('p')
    expect(sentHeaders(0).get('if-none-match')).toBeNull()

    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { etag: 'W/"v1"' } }),
    )
    const second = await fetchHypotheses('p')
    expect(sentHeaders(1).get('if-none-match')).toBe('W/"v1"')
    expect(second).toBe(first)
  })

  it('retries without conditional headers when the remembered body was evicted', async () => {
    fetchMock.mockResolvedValueOnce(ok())
    await fetchHypotheses('p')
    // The body cache loses the entry while the conditional request is in flight.
    fetchMock.mockImplementationOnce(async () => {
      __resetResourceProtocolForTests()
      return new Response(null, { status: 304 })
    })
    fetchMock.mockResolvedValueOnce(ok())
    const result = await fetchHypotheses('p')
    expect(sentHeaders(1).get('if-none-match')).toBe('W/"v1"')
    expect(sentHeaders(2).get('if-none-match')).toBeNull()
    expect(result).toEqual(body)
  })
})
