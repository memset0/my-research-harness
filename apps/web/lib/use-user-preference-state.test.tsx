import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserPreferenceState } from './use-user-preference-state'

const KEY = 'memon:test:preferences'
const INITIAL = { filters: [] as string[] }

function Harness() {
  const [preference, setPreference] = useUserPreferenceState(KEY, INITIAL)
  return (
    <>
      <output aria-label="preference">{JSON.stringify(preference)}</output>
      <button type="button" onClick={() => setPreference({ filters: ['new'] })}>
        Change
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
      .mockResolvedValueOnce(jsonResponse({ found: true, value: { filters: ['browser'] } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('preference')).toHaveTextContent('{"filters":["browser"]}')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      key: KEY,
      value: { filters: ['browser'] },
    })
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

    resolvePut(jsonResponse({ found: true, value: { filters: ['new'] } }))
  })
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
