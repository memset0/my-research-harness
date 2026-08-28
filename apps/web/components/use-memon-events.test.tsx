// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeMemonEvents } from '../lib/events-client'
import { SessionProvider, type SessionRole } from './session-provider'
import { useMemonEvents } from './use-memon-events'

vi.mock('../lib/events-client', () => ({
  subscribeMemonEvents: vi.fn(() => vi.fn()),
}))

function Probe() {
  useMemonEvents()
  return null
}

function renderWithRole(role: SessionRole) {
  const client = new QueryClient()
  return render(
    <SessionProvider value={{ role, scopeProjects: [], scopeProjectRefs: [] }}>
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    </SessionProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useMemonEvents authentication lifecycle', () => {
  it('does not open the authenticated SSE stream on the anonymous login tree', () => {
    renderWithRole('anon')
    expect(subscribeMemonEvents).not.toHaveBeenCalled()
  })

  it.each(['owner', 'viewer'] as const)('subscribes for an authenticated %s', (role) => {
    renderWithRole(role)
    expect(subscribeMemonEvents).toHaveBeenCalledOnce()
  })
})
