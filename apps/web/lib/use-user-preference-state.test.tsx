import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserPreferenceState } from './use-user-preference-state'

const KEY = 'memon:test:preferences'
const INITIAL = { filters: [] as string[] }

function Harness({ storageKey = KEY }: { storageKey?: string }) {
  const [preference, setPreference] = useUserPreferenceState(storageKey, INITIAL)
  return (
    <>
      <output aria-label="preference">{JSON.stringify(preference)}</output>
      <button type="button" onClick={() => setPreference({ filters: ['new'] })}>
        Change
      </button>
      <button
        type="button"
        onClick={() => {
          setPreference((current) => ({ filters: [...current.filters, 'one'] }))
          setPreference((current) => ({ filters: [...current.filters, 'two'] }))
        }}
      >
        Batch change
      </button>
      <button type="button" onClick={() => setPreference({ filters: [] })}>
        Clear
      </button>
      <button
        type="button"
        onClick={() => setPreference((current) => ({ filters: [...current.filters] }))}
      >
        Same value
      </button>
    </>
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useUserPreferenceState', () => {
  it('lets a present SQLite row override conflicting browser data, including an empty value', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ filters: ['browser'] }))
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ found: true, value: { filters: [] }, updatedAt: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness />)

    await waitFor(() =>
      expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify({ filters: [] })),
    )
    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":[]}')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses and migrates browser data when SQLite explicitly reports no row', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ filters: ['browser'] }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ found: false }))
      .mockResolvedValueOnce(
        jsonResponse({ found: true, value: { filters: ['browser'] }, updatedAt: 2 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":["browser"]}')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      key: KEY,
      value: { filters: ['browser'] },
    })
  })

  it('keeps a user change made while a found SQLite row is still loading', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ filters: ['browser'] }))
    let resolveGet!: (response: Response) => void
    const pendingGet = new Promise<Response>((resolve) => {
      resolveGet = resolve
    })
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(pendingGet)
      .mockResolvedValueOnce(
        jsonResponse({ found: true, value: { filters: ['new'] }, updatedAt: 2 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText('preference')).toHaveTextContent('browser'))
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    resolveGet(jsonResponse({ found: true, value: { filters: ['older-server'] }, updatedAt: 1 }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":["new"]}')
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify({ filters: ['new'] }))
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      key: KEY,
      value: { filters: ['new'] },
    })
  })

  it('ignores a delayed hydration response older than an acknowledged local mutation', async () => {
    const storageKey = 'memon:test:stale-hydration-after-ack'
    let resolveGet!: (response: Response) => void
    const pendingGet = new Promise<Response>((resolve) => {
      resolveGet = resolve
    })
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return Promise.resolve(
          jsonResponse({ found: true, value: { filters: ['new'] }, updatedAt: 20 }),
        )
      }
      return pendingGet
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness storageKey={storageKey} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    await waitFor(() =>
      expect(readSyncState(storageKey)).toMatchObject({ dirty: false, serverUpdatedAt: 20 }),
    )

    resolveGet(jsonResponse({ found: true, value: { filters: ['server-older'] }, updatedAt: 10 }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":["new"]}')
    expect(window.localStorage.getItem(storageKey)).toBe(JSON.stringify({ filters: ['new'] }))
  })

  it('composes functional updates before React renders again', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Batch change' }))

    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":["one","two"]}')
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify({ filters: ['one', 'two'] }))
  })

  it('keeps viewer and anonymous sessions browser-only', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ filters: ['browser'] }))
    const fetchMock = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))

    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":["new"]}')
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify({ filters: ['new'] }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('updates UI and browser storage without waiting for the server PUT', async () => {
    let resolvePut!: (response: Response) => void
    const pendingPut = new Promise<Response>((resolve) => {
      resolvePut = resolve
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ found: true, value: { filters: [] } }))
      .mockReturnValueOnce(pendingPut)
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))

    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":["new"]}')
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify({ filters: ['new'] }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    resolvePut(jsonResponse({ found: true, value: { filters: ['new'] }, updatedAt: 2 }))
  })

  it('hydrates a found server value when the browser has no local record or mutation', async () => {
    const storageKey = 'memon:test:no-local'
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ found: true, value: { filters: ['server'] }, updatedAt: 10 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness storageKey={storageKey} />)

    await waitFor(() =>
      expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":["server"]}'),
    )
    expect(window.localStorage.getItem(storageKey)).toBe(JSON.stringify({ filters: ['server'] }))
    expect(readSyncState(storageKey)).toMatchObject({ dirty: false, serverUpdatedAt: 10 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps and uploads a durable dirty local value instead of accepting stale SQLite', async () => {
    const storageKey = 'memon:test:dirty-local'
    window.localStorage.setItem(storageKey, JSON.stringify({ filters: ['local-newer'] }))
    window.localStorage.setItem(
      syncKey(storageKey),
      JSON.stringify({ version: 1, dirty: true, mutationId: 'local-change' }),
    )
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return jsonResponse({ found: true, value: { filters: ['local-newer'] }, updatedAt: 20 })
      }
      return jsonResponse({ found: true, value: { filters: ['server-older'] }, updatedAt: 10 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness storageKey={storageKey} />)

    await waitFor(() => expect(putCalls(fetchMock)).toHaveLength(1))
    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":["local-newer"]}')
    expect(JSON.parse(String(putCalls(fetchMock)[0]?.[1]?.body))).toEqual({
      key: storageKey,
      value: { filters: ['local-newer'] },
    })
    await waitFor(() => expect(readSyncState(storageKey)).toMatchObject({ dirty: false }))
  })

  it('treats an explicit user clear as a dirty empty value until it is acknowledged', async () => {
    const storageKey = 'memon:test:explicit-empty'
    let resolvePut!: (response: Response) => void
    const pendingPut = new Promise<Response>((resolve) => {
      resolvePut = resolve
    })
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return pendingPut
      return Promise.resolve(
        jsonResponse({ found: true, value: { filters: ['server'] }, updatedAt: 10 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness storageKey={storageKey} />)
    await waitFor(() => expect(screen.getByLabelText('preference')).toHaveTextContent('server'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(putCalls(fetchMock)).toHaveLength(1))
    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":[]}')
    expect(window.localStorage.getItem(storageKey)).toBe(JSON.stringify({ filters: [] }))
    expect(readSyncState(storageKey)).toMatchObject({ dirty: true })
    expect(JSON.parse(String(putCalls(fetchMock)[0]?.[1]?.body))).toEqual({
      key: storageKey,
      value: { filters: [] },
    })

    resolvePut(jsonResponse({ found: true, value: { filters: [] }, updatedAt: 11 }))
    await waitFor(() =>
      expect(readSyncState(storageKey)).toMatchObject({ dirty: false, serverUpdatedAt: 11 }),
    )
  })

  it('does not mark or upload a same-value setter as a user mutation', async () => {
    const storageKey = 'memon:test:same-value'
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ found: true, value: { filters: ['server'] }, updatedAt: 10 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness storageKey={storageKey} />)
    await waitFor(() => expect(screen.getByLabelText('preference')).toHaveTextContent('server'))
    fireEvent.click(screen.getByRole('button', { name: 'Same value' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readSyncState(storageKey)).toMatchObject({ dirty: false, serverUpdatedAt: 10 })
  })

  it('retains a failed mutation and retries it instead of accepting stale server state', async () => {
    const storageKey = 'memon:test:retry-dirty'
    let putCount = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putCount += 1
        if (putCount === 1) return new Response('Unavailable', { status: 503 })
        return jsonResponse({ found: true, value: { filters: ['new'] }, updatedAt: 20 })
      }
      return jsonResponse({ found: true, value: { filters: ['server-old'] }, updatedAt: 10 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = render(<Harness storageKey={storageKey} />)
    await waitFor(() => expect(screen.getByLabelText('preference')).toHaveTextContent('server-old'))
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    await waitFor(() => expect(putCount).toBe(1))
    expect(readSyncState(storageKey)).toMatchObject({ dirty: true })
    first.unmount()

    render(<Harness storageKey={storageKey} />)
    await waitFor(() => expect(putCount).toBe(2))
    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":["new"]}')
    await waitFor(() =>
      expect(readSyncState(storageKey)).toMatchObject({ dirty: false, serverUpdatedAt: 20 }),
    )
  })

  it('finishes the latest queued mutation after the component unmounts', async () => {
    const storageKey = 'memon:test:unmount-queue'
    let resolveFirstPut!: (response: Response) => void
    const firstPut = new Promise<Response>((resolve) => {
      resolveFirstPut = resolve
    })
    let putCount = 0
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PUT') {
        return Promise.resolve(jsonResponse({ found: true, value: { filters: [] }, updatedAt: 1 }))
      }
      putCount += 1
      if (putCount === 1) return firstPut
      return Promise.resolve(
        jsonResponse({ found: true, value: { filters: ['one', 'two'] }, updatedAt: 3 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const rendered = render(<Harness storageKey={storageKey} />)
    await waitFor(() => expect(screen.getByLabelText('preference')).toHaveTextContent('filters'))
    fireEvent.click(screen.getByRole('button', { name: 'Batch change' }))
    await waitFor(() => expect(putCalls(fetchMock)).toHaveLength(1))
    rendered.unmount()

    resolveFirstPut(jsonResponse({ found: true, value: { filters: ['one'] }, updatedAt: 2 }))
    await waitFor(() => expect(putCalls(fetchMock)).toHaveLength(2))
    expect(JSON.parse(String(putCalls(fetchMock)[1]?.[1]?.body))).toEqual({
      key: storageKey,
      value: { filters: ['one', 'two'] },
    })
    await waitFor(() =>
      expect(readSyncState(storageKey)).toMatchObject({ dirty: false, serverUpdatedAt: 3 }),
    )
  })
})

function syncKey(key: string): string {
  return `memon:ui-preference-sync:${key}`
}

function readSyncState(key: string): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(syncKey(key)) ?? '{}') as Record<string, unknown>
}

function putCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((call) => call[1]?.method === 'PUT')
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
