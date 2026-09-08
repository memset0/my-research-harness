// @vitest-environment jsdom

import { useQuery } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResourceHeartbeat } from '../../components/resource-heartbeat-provider'
import { renderWithHeartbeat } from '../utils'

/** Default foreground cadence (see `lib/runtime-config.ts`). */
const HEARTBEAT_MS = 30_000
/** Margin around the cadence boundary so a few ms of timer drift cannot flake. */
const MARGIN_MS = 2_000

interface ListPayload {
  pages: never[]
}

interface Deferred {
  resolve: (value: ListPayload) => void
  reject: (error: Error) => void
}

/**
 * List requests are settled by hand: a heartbeat that fires while a response is
 * outstanding is exactly the accumulation this provider must not produce, so the
 * test — not the event loop — decides when a request finishes.
 */
let outstanding: Deferred[] = []
// `Promise.withResolvers` is ES2024; this workspace compiles against
// `lib: ES2022`, so the executor form is the available construction here.
const listFetch = vi.fn(
  () =>
    new Promise<ListPayload>((resolve, reject) => {
      outstanding.push({ resolve, reject })
    }),
)
const inventoryFetch = vi.fn(async () => ({ pages: [] }))
const wikiPageFetch = vi.fn(async () => ({ id: 'W0001' }))
const runBodyFetch = vi.fn(async () => ({ id: 'R1' }))

let refresh: ((reason?: 'manual' | 'focus') => void) | null = null

function Probe() {
  useQuery({ queryKey: ['wiki', 'project-a'], queryFn: listFetch })
  useQuery({ queryKey: ['wiki-inventory', 'project-a'], queryFn: inventoryFetch })
  useQuery({ queryKey: ['wiki-page', 'project-a', 'W0001'], queryFn: wikiPageFetch })
  useQuery({ queryKey: ['run', 'project-a', 'R1'], queryFn: runBodyFetch })
  refresh = useResourceHeartbeat().refresh
  return null
}

let focused = true

beforeEach(() => {
  vi.clearAllMocks()
  outstanding = []
  refresh = null
  focused = true
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function setForeground(next: boolean) {
  focused = next
  await act(async () => {
    window.dispatchEvent(new Event(next ? 'focus' : 'blur'))
  })
}

/** Settle the oldest outstanding list request and let the pulse finish. */
async function settleList(mode: 'resolve' | 'reject' = 'resolve') {
  const next = outstanding.shift()
  if (!next) throw new Error('no outstanding list request to settle')
  await act(async () => {
    if (mode === 'resolve') next.resolve({ pages: [] })
    else next.reject(new Error('disk went away'))
    // Flush the pulse's own continuation (state updates + next arming).
    await vi.advanceTimersByTimeAsync(1)
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function mountForeground() {
  renderWithHeartbeat(<Probe />)
  // Mount fetches are the page's own load. The initial focus pulse joins the
  // detail fetch and leaves the collection request at background priority.
  await waitFor(() => {
    expect(listFetch).toHaveBeenCalledTimes(1)
    expect(inventoryFetch).toHaveBeenCalledTimes(1)
    expect(wikiPageFetch).toHaveBeenCalledTimes(1)
    expect(runBodyFetch).toHaveBeenCalledTimes(1)
  })
}

describe('shared foreground heartbeat', () => {
  it('does not duplicate an outstanding collection and re-arms from its settlement', async () => {
    await mountForeground()

    // Three cadences pass with the first collection response still outstanding.
    await advance(HEARTBEAT_MS * 3)
    expect(listFetch).toHaveBeenCalledTimes(1)
    expect(inventoryFetch).toHaveBeenCalledTimes(2)
    expect(wikiPageFetch).toHaveBeenCalledTimes(2)

    await settleList()
    // The cadence is measured from the answer, not from the request.
    await advance(HEARTBEAT_MS - MARGIN_MS)
    expect(listFetch).toHaveBeenCalledTimes(1)

    await advance(MARGIN_MS * 2)
    await waitFor(() => expect(listFetch).toHaveBeenCalledTimes(2))
    // One pulse per cadence, never a backlog catching up.
    expect(outstanding).toHaveLength(1)
    expect(inventoryFetch).toHaveBeenCalledTimes(3)
    expect(wikiPageFetch).toHaveBeenCalledTimes(3)
    expect(runBodyFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps beating after a failed automatic pulse', async () => {
    await mountForeground()
    await settleList()

    await advance(HEARTBEAT_MS + MARGIN_MS)
    await waitFor(() => expect(listFetch).toHaveBeenCalledTimes(2))
    await settleList('reject')

    await advance(HEARTBEAT_MS - MARGIN_MS)
    expect(listFetch).toHaveBeenCalledTimes(2)

    await advance(MARGIN_MS * 2)
    await waitFor(() => expect(listFetch).toHaveBeenCalledTimes(3))
  })

  it('refreshes only a stale document when the tab returns to the foreground', async () => {
    await mountForeground()
    await settleList()

    await setForeground(false)
    await advance(HEARTBEAT_MS * 2)
    expect(listFetch).toHaveBeenCalledTimes(1)
    expect(inventoryFetch).toHaveBeenCalledTimes(1)
    expect(wikiPageFetch).toHaveBeenCalledTimes(1)

    await setForeground(true)
    await waitFor(() => expect(wikiPageFetch).toHaveBeenCalledTimes(2))
    expect(listFetch).toHaveBeenCalledTimes(1)
    expect(inventoryFetch).toHaveBeenCalledTimes(1)
    expect(runBodyFetch).toHaveBeenCalledTimes(1)
  })

  it('does not resurrect the loop when an automatic pulse lands after the tab left', async () => {
    await mountForeground()
    await settleList()
    await advance(HEARTBEAT_MS + MARGIN_MS)
    await waitFor(() => expect(listFetch).toHaveBeenCalledTimes(2))

    await setForeground(false)
    // The automatic request started while in front now answers to a background tab.
    await settleList()

    await advance(HEARTBEAT_MS * 3)
    expect(listFetch).toHaveBeenCalledTimes(2)
  })

  it('does not promote an outstanding collection when the tab is re-focused', async () => {
    await mountForeground()

    await setForeground(false)
    await advance(HEARTBEAT_MS * 2)
    await setForeground(true)

    await waitFor(() => expect(wikiPageFetch).toHaveBeenCalledTimes(2))
    expect(listFetch).toHaveBeenCalledTimes(1)
    expect(inventoryFetch).toHaveBeenCalledTimes(1)
    expect(outstanding).toHaveLength(1)

    await settleList()
    await advance(HEARTBEAT_MS + MARGIN_MS)
    await waitFor(() => expect(listFetch).toHaveBeenCalledTimes(2))
  })

  it('manually refreshes the document only and restarts the automatic cadence', async () => {
    await mountForeground()
    await settleList()

    await advance(HEARTBEAT_MS - MARGIN_MS * 5)
    expect(listFetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      refresh?.()
    })
    await waitFor(() => expect(wikiPageFetch).toHaveBeenCalledTimes(2))
    expect(listFetch).toHaveBeenCalledTimes(1)
    expect(inventoryFetch).toHaveBeenCalledTimes(1)

    // Past the moment the dropped automatic tick would have fired.
    await advance(MARGIN_MS * 5 + MARGIN_MS)
    expect(listFetch).toHaveBeenCalledTimes(1)

    // The manual pulse's own automatic cadence still refreshes the collection.
    await advance(HEARTBEAT_MS)
    await waitFor(() => expect(listFetch).toHaveBeenCalledTimes(2))
    expect(inventoryFetch).toHaveBeenCalledTimes(2)
    expect(wikiPageFetch).toHaveBeenCalledTimes(3)
    expect(runBodyFetch).toHaveBeenCalledTimes(1)
  })

  it('never refetches a Run README body automatically', async () => {
    await mountForeground()
    for (let i = 0; i < 3; i += 1) {
      await settleList()
      await advance(HEARTBEAT_MS + MARGIN_MS)
    }
    expect(listFetch.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(runBodyFetch).toHaveBeenCalledTimes(1)
  })
})
