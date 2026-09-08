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
    renderWithHeartbeat(<PageFreshness />)
    const now = Date.now()
    act(() => {
      observe('/api/wiki', { oldestVerifiedAt: now - 5_000 }, 'v1')
      observe('/api/reports', { oldestVerifiedAt: now - 40_000, queued: 2 }, 'r1')
    })

    expect(screen.getByText(/oldest check 40s ago/)).toBeInTheDocument()
    expect(screen.getByText(/2 queued/)).toBeInTheDocument()
  })

  it('says nothing has been read before the first observation', () => {
    renderWithHeartbeat(<PageFreshness />)
    expect(screen.getByText('nothing read yet')).toBeInTheDocument()
  })

  it('keeps the successful age visible when a dependency is failing', () => {
    renderWithHeartbeat(<PageFreshness />)
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
})
