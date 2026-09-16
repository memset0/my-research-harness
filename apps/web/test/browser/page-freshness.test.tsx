// @vitest-environment jsdom

import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageFreshness } from '../../components/page-freshness'
import {
  __resetResourceProtocolForTests,
  beginResourceRequest,
  FILE_STATUS_HEADER,
  recordResourceResponse,
  RESOURCE_VERSION_HEADER,
} from '../../lib/resource-protocol'
import { renderWithHeartbeat } from '../utils'

function observe(url: string, status: Record<string, unknown>, version: string) {
  recordResourceResponse(
    beginResourceRequest(url),
    new Response(null, {
      status: 200,
      headers: {
        [RESOURCE_VERSION_HEADER]: version,
        [FILE_STATUS_HEADER]: JSON.stringify({
          epoch: 'epoch-1',
          oldestVerifiedAt: null,
          incomplete: false,
          queued: 0,
          checking: 0,
          error: null,
          version: 'obs',
          ...status,
        }),
      },
    }),
    {},
  )
}

beforeEach(() => {
  __resetResourceProtocolForTests()
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
})

afterEach(() => vi.restoreAllMocks())
describe('footer page freshness', () => {
  it('quotes the oldest dependency observation, not the newest', () => {
    renderWithHeartbeat(<PageFreshness project="research" />)
    const now = Date.now()
    act(() => {
      observe('/api/wiki', { oldestVerifiedAt: now - 5_000 }, 'v1')
      observe('/api/reports', { oldestVerifiedAt: now - 40_000, queued: 2 }, 'r1')
    })

    expect(screen.getByText(/oldest check 40s ago/)).toBeInTheDocument()
    expect(screen.getByText(/2 queued/)).toBeInTheDocument()
  })

  it('says nothing has been read before the first observation', () => {
    renderWithHeartbeat(<PageFreshness project="research" />)
    expect(screen.getByText('nothing read yet')).toBeInTheDocument()
  })

  it('keeps the successful age visible when a dependency is failing', () => {
    renderWithHeartbeat(<PageFreshness project="research" />)
    act(() => {
      observe(
        '/api/wiki',
        { oldestVerifiedAt: Date.now() - 12_000, error: 'stat timed out', incomplete: true },
        'v1',
      )
    })

    expect(screen.getByText(/oldest check 12s ago/)).toBeInTheDocument()
    expect(screen.getByText(/partial/)).toBeInTheDocument()
    expect(screen.getByText('refresh failed')).toBeInTheDocument()
  })

  it('names a direct project instead of quoting an age or a queue', () => {
    renderWithHeartbeat(<PageFreshness project="research" />)
    act(() => {
      observe('/api/wiki', { direct: true, version: 'direct' }, 'v1')
      observe('/api/reports', { direct: true, version: 'direct' }, 'r1')
    })

    expect(screen.getByText('reads research directly')).toBeInTheDocument()
    expect(screen.queryByText(/oldest check/)).not.toBeInTheDocument()
    expect(screen.queryByText(/checking dependencies/)).not.toBeInTheDocument()
    expect(screen.queryByText(/queued/)).not.toBeInTheDocument()
    expect(screen.queryByText(/partial/)).not.toBeInTheDocument()
    expect(screen.queryByText('refresh failed')).not.toBeInTheDocument()
  })

  it('still reports an error on a direct page', () => {
    renderWithHeartbeat(<PageFreshness project="research" />)
    act(() => {
      observe('/api/wiki', { direct: true, version: 'direct', error: 'EACCES' }, 'v1')
    })

    expect(screen.getByText('reads research directly')).toBeInTheDocument()
    expect(screen.getByText('refresh failed')).toBeInTheDocument()
  })

  it('falls back to scheduled wording when one dependency is still scheduled', () => {
    renderWithHeartbeat(<PageFreshness project="research" />)
    act(() => {
      observe('/api/wiki', { direct: true, version: 'direct' }, 'v1')
      observe('/api/reports', { oldestVerifiedAt: Date.now() - 9_000, queued: 1 }, 'r1')
    })

    expect(screen.getByText(/oldest check 9s ago/)).toBeInTheDocument()
    expect(screen.getByText(/1 queued/)).toBeInTheDocument()
  })
})
