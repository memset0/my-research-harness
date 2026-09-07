// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeMemonEvents } from '../lib/events-client'
import { SessionProvider, type SessionRole } from './session-provider'
import { useMemonEvents } from './use-memon-events'

vi.mock('../lib/events-client', () => ({
  subscribeMemonEvents: vi.fn(() => vi.fn()),
}))

let listener:
  | ((event: Parameters<Parameters<typeof subscribeMemonEvents>[0]>[0]) => void)
  | null = null

function Probe() {
  useMemonEvents()
  return null
}

function renderWithRole(role: SessionRole) {
  const client = new QueryClient()
  const view = render(
    <SessionProvider value={{ role, scopeProjects: [], scopeProjectRefs: [] }}>
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    </SessionProvider>,
  )
  return { client, view }
}

afterEach(() => {
  listener = null
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

  it('invalidates the matching wiki prefix when an Experiment event omits Project', () => {
    vi.mocked(subscribeMemonEvents).mockImplementationOnce((next) => {
      listener = next
      return vi.fn()
    })
    const { client } = renderWithRole('owner')
    const hostA = ['wiki', 'host-a', 'project-a'] as const
    const hostB = ['wiki', 'host-b', 'project-a'] as const
    client.setQueryData(hostA, { wiki: [] })
    client.setQueryData(hostB, { wiki: [] })

    act(() => {
      listener?.({ topic: 'experiment-change', host: 'host-a' })
    })

    expect(client.getQueryState(hostA)?.isInvalidated).toBe(true)
    expect(client.getQueryState(hostB)?.isInvalidated).toBe(false)
  })
})
