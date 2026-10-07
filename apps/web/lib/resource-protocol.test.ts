// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetResourceProtocolForTests,
  ATTENTION_HEADER,
  beginResourceRequest,
  consumeResourceChanges,
  EPOCH_HEADER,
  ETAG_HEADER,
  FILE_STATUS_HEADER,
  getResourceStatusSnapshot,
  IF_NONE_MATCH_HEADER,
  KNOWN_VERSION_HEADER,
  markResourceOpen,
  REASON_HEADER,
  RESOURCE_VERSION_HEADER,
  recordResourceResponse,
  resetResourceScope,
  resolveNotModified,
  withResourceReason,
} from './resource-protocol'

interface StatusHeader {
  epoch: string
  oldestVerifiedAt: number | null
  incomplete: boolean
  queued: number
  checking: number
  error: string | null
  direct: boolean
  version: string
}

function statusHeader(overrides: Partial<StatusHeader> = {}): string {
  return JSON.stringify({
    epoch: 'epoch-1',
    oldestVerifiedAt: 1_000,
    incomplete: false,
    queued: 0,
    checking: 0,
    error: null,
    version: 'obs-1',
    ...overrides,
  })
}

function jsonResponse(headers: Record<string, string>): Response {
  return new Response(null, { status: 200, headers })
}

beforeEach(() => {
  __resetResourceProtocolForTests()
  window.sessionStorage.clear()
})

describe('resource request headers', () => {
  it('keeps Wiki collections automatic while opening the selected page as foreground work', () => {
    markResourceOpen(5_000)

    expect(beginResourceRequest('/api/wiki?project=research').headers[REASON_HEADER]).toBe(
      'automatic',
    )
    expect(beginResourceRequest('/api/wiki/W0001?project=research').headers[REASON_HEADER]).toBe(
      'open',
    )
  })

  it('normalizes collection reads even inside human scopes or with a caller reason header', () => {
    for (const reason of ['manual', 'focus', 'heartbeat'] as const) {
      const collection = withResourceReason(reason, () =>
        beginResourceRequest('/api/wiki?inventory=1', {
          headers: { [REASON_HEADER]: 'manual' },
        }),
      )
      expect(collection.headers[REASON_HEADER]).toBe('automatic')
    }

    const detail = withResourceReason('manual', () =>
      beginResourceRequest('/api/wiki/W0001?project=research'),
    )
    expect(detail.headers[REASON_HEADER]).toBe('manual')
    // The scope must not leak past the batch it wrapped.
    expect(beginResourceRequest('/api/wiki/W0001').headers[REASON_HEADER]).toBe('automatic')
  })

  it('treats HEAD as a read but keeps every mutation at write priority', () => {
    const collectionHead = withResourceReason('focus', () =>
      beginResourceRequest('/api/wiki', { method: 'HEAD' }),
    )
    expect(collectionHead.headers[REASON_HEADER]).toBe('automatic')
    expect(collectionHead.cacheable).toBe(false)

    const detailHead = withResourceReason('focus', () =>
      beginResourceRequest('/api/wiki/W0001', { method: 'HEAD' }),
    )
    expect(detailHead.headers[REASON_HEADER]).toBe('focus')

    const write = beginResourceRequest('/api/wiki', { method: 'POST' })
    expect(write.headers[REASON_HEADER]).toBe('write')
    expect(write.cacheable).toBe(false)
  })

  it('reuses one attention id for the tab', () => {
    const first = beginResourceRequest('/api/wiki').headers[ATTENTION_HEADER]
    expect(first).toBeTruthy()
    expect(beginResourceRequest('/api/reports').headers[ATTENTION_HEADER]).toBe(first)
  })

  it('offers a known version only for the url it was observed on', () => {
    const request = beginResourceRequest('/api/wiki')
    recordResourceResponse(
      request,
      jsonResponse({ [RESOURCE_VERSION_HEADER]: 'v1', [FILE_STATUS_HEADER]: statusHeader() }),
      { pages: [] },
    )
    expect(beginResourceRequest('/api/wiki').headers[KNOWN_VERSION_HEADER]).toBe('v1')
    expect(beginResourceRequest('/api/reports').headers[KNOWN_VERSION_HEADER]).toBeUndefined()
  })
})

describe('list validators', () => {
  it('sends the remembered ETag back as If-None-Match next to the known version', () => {
    recordResourceResponse(
      beginResourceRequest('/api/experiments?project=p'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'v1',
        [ETAG_HEADER]: 'W/"abc"',
        [FILE_STATUS_HEADER]: statusHeader(),
      }),
      { experiments: [] },
    )
    const next = beginResourceRequest('/api/experiments?project=p')
    expect(next.headers[IF_NONE_MATCH_HEADER]).toBe('W/"abc"')
    expect(next.headers[KNOWN_VERSION_HEADER]).toBe('v1')
    expect(next.conditional).toBe(true)
  })

  it('omits If-None-Match on the unconditional retry and for unseen urls', () => {
    recordResourceResponse(
      beginResourceRequest('/api/wiki'),
      jsonResponse({ [ETAG_HEADER]: 'W/"w"' }),
      { pages: [] },
    )
    expect(beginResourceRequest('/api/wiki', undefined, false).headers[IF_NONE_MATCH_HEADER]).toBe(
      undefined,
    )
    expect(beginResourceRequest('/api/reports').headers[IF_NONE_MATCH_HEADER]).toBeUndefined()
  })
})

describe('semantic version reuse', () => {
  it('hands back the exact previous body when nothing changed', () => {
    const body = { pages: [{ id: 'W0001' }] }
    const first = beginResourceRequest('/api/wiki')
    recordResourceResponse(
      first,
      jsonResponse({ [RESOURCE_VERSION_HEADER]: 'v1', [FILE_STATUS_HEADER]: statusHeader() }),
      body,
    )
    expect(consumeResourceChanges()).toBe(0)

    const second = beginResourceRequest('/api/wiki')
    const reuse = resolveNotModified(
      second,
      new Response(null, {
        status: 304,
        headers: { [FILE_STATUS_HEADER]: statusHeader({ oldestVerifiedAt: 4_000 }) },
      }),
    )
    expect(reuse.hit).toBe(true)
    expect(reuse.hit && reuse.body).toBe(body)
    // Verifying an unchanged resource is not a content update.
    expect(consumeResourceChanges()).toBe(0)
    // …but it does refresh the freshness the footer reports.
    expect(getResourceStatusSnapshot().oldestVerifiedAt).toBe(4_000)
  })

  it('refreshes edit-lock metadata without retransmitting or changing document content', () => {
    const body = { content: '# Same', mtime: 1, hash: 'a'.repeat(40) }
    const url = '/api/readme?project=project-a'
    recordResourceResponse(
      beginResourceRequest(url),
      jsonResponse({ [RESOURCE_VERSION_HEADER]: 'v1' }),
      body,
    )
    const result = resolveNotModified(
      beginResourceRequest(url),
      new Response(null, {
        status: 304,
        headers: {
          'x-memon-document-mtime': '2',
          'x-memon-document-hash': 'a'.repeat(40),
        },
      }),
    )
    expect(result.hit && result.body).toEqual({ ...body, mtime: 2 })
    expect(consumeResourceChanges()).toBe(0)
  })

  it('reports a change exactly once when the version moves', () => {
    for (const version of ['v1', 'v2']) {
      recordResourceResponse(
        beginResourceRequest('/api/wiki'),
        jsonResponse({ [RESOURCE_VERSION_HEADER]: version, [FILE_STATUS_HEADER]: statusHeader() }),
        { version },
      )
    }
    expect(consumeResourceChanges()).toBe(1)
    expect(consumeResourceChanges()).toBe(0)
  })

  it('asks for a full body again when the cached one is gone', () => {
    const request = beginResourceRequest('/api/wiki')
    const reuse = resolveNotModified(request, new Response(null, { status: 304 }))
    expect(reuse.hit).toBe(false)
  })

  it('forgets known versions after the store restarts', () => {
    recordResourceResponse(
      beginResourceRequest('/api/wiki'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'v1',
        [EPOCH_HEADER]: 'epoch-1',
        [FILE_STATUS_HEADER]: statusHeader(),
      }),
      { pages: [] },
    )
    recordResourceResponse(
      beginResourceRequest('/api/reports'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'r1',
        [EPOCH_HEADER]: 'epoch-2',
        [FILE_STATUS_HEADER]: statusHeader({ epoch: 'epoch-2' }),
      }),
      { reports: [] },
    )
    expect(beginResourceRequest('/api/wiki').headers[KNOWN_VERSION_HEADER]).toBeUndefined()
  })
})

describe('page freshness aggregate', () => {
  it('uses the oldest observation and the largest queue over all dependencies', () => {
    recordResourceResponse(
      beginResourceRequest('/api/wiki'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'v1',
        [FILE_STATUS_HEADER]: statusHeader({ oldestVerifiedAt: 40_000, queued: 1, checking: 2 }),
      }),
      { pages: [] },
    )
    recordResourceResponse(
      beginResourceRequest('/api/reports'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'r1',
        [FILE_STATUS_HEADER]: statusHeader({ oldestVerifiedAt: 95_000, queued: 3, checking: 0 }),
      }),
      { reports: [] },
    )

    const snapshot = getResourceStatusSnapshot()
    expect(snapshot.oldestVerifiedAt).toBe(40_000)
    expect(snapshot.queued).toBe(3)
    expect(snapshot.checking).toBe(2)
    expect(snapshot.incomplete).toBe(false)
    expect(snapshot.resources).toBe(2)
    expect(snapshot.direct).toBe(false)
  })

  it('reports a direct page and keeps its scheduler fields inert', () => {
    recordResourceResponse(
      beginResourceRequest('/api/wiki'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'v1',
        [FILE_STATUS_HEADER]: statusHeader({
          oldestVerifiedAt: null,
          direct: true,
          version: 'direct',
        }),
      }),
      { pages: [] },
    )
    recordResourceResponse(
      beginResourceRequest('/api/reports'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'r1',
        [FILE_STATUS_HEADER]: statusHeader({
          oldestVerifiedAt: null,
          direct: true,
          version: 'direct',
        }),
      }),
      { reports: [] },
    )

    const snapshot = getResourceStatusSnapshot()
    expect(snapshot.direct).toBe(true)
    // A direct read has no observation vector, so it must not look partial.
    expect(snapshot.incomplete).toBe(false)
    expect(snapshot.oldestVerifiedAt).toBeNull()
    expect(snapshot.queued).toBe(0)
    expect(snapshot.resources).toBe(2)
  })

  it('stops claiming a direct page as soon as one dependency is scheduled', () => {
    recordResourceResponse(
      beginResourceRequest('/api/wiki'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'v1',
        [FILE_STATUS_HEADER]: statusHeader({
          oldestVerifiedAt: null,
          direct: true,
          version: 'direct',
        }),
      }),
      { pages: [] },
    )
    recordResourceResponse(
      beginResourceRequest('/api/reports'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'r1',
        [FILE_STATUS_HEADER]: statusHeader({ oldestVerifiedAt: 8_000, queued: 2 }),
      }),
      { reports: [] },
    )

    const snapshot = getResourceStatusSnapshot()
    expect(snapshot.direct).toBe(false)
    expect(snapshot.oldestVerifiedAt).toBe(8_000)
    expect(snapshot.queued).toBe(2)
  })

  it('never calls an empty page direct', () => {
    expect(getResourceStatusSnapshot().direct).toBe(false)
    expect(getResourceStatusSnapshot().resources).toBe(0)
  })

  it('marks freshness incomplete while a dependency has never been observed', () => {
    recordResourceResponse(
      beginResourceRequest('/api/wiki'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'v1',
        [FILE_STATUS_HEADER]: statusHeader({ oldestVerifiedAt: null, incomplete: true }),
      }),
      { pages: [] },
    )
    expect(getResourceStatusSnapshot().incomplete).toBe(true)
    expect(getResourceStatusSnapshot().oldestVerifiedAt).toBeNull()
  })

  it('keeps the last error visible alongside the successful age', () => {
    recordResourceResponse(
      beginResourceRequest('/api/wiki'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'v1',
        [FILE_STATUS_HEADER]: statusHeader({ oldestVerifiedAt: 7_000, error: 'stat timed out' }),
      }),
      { pages: [] },
    )
    const snapshot = getResourceStatusSnapshot()
    expect(snapshot.error).toBe('stat timed out')
    expect(snapshot.oldestVerifiedAt).toBe(7_000)
  })

  it('drops the previous page dependencies on navigation', () => {
    recordResourceResponse(
      beginResourceRequest('/api/wiki'),
      jsonResponse({
        [RESOURCE_VERSION_HEADER]: 'v1',
        [FILE_STATUS_HEADER]: statusHeader({ oldestVerifiedAt: 2_000 }),
      }),
      { pages: [] },
    )
    resetResourceScope('/p/project-a/reports')
    const snapshot = getResourceStatusSnapshot()
    expect(snapshot.resources).toBe(0)
    expect(snapshot.oldestVerifiedAt).toBeNull()
  })
})
