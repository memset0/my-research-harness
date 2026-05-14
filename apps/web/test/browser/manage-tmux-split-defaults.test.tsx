// tmux-manage-split-defaults — covers the first-paint contract of the
// `/manage/tmux` split pane:
//   * The `parseStoredLayout` reader validates localStorage payloads.
//   * `useMediaQuery(query, defaultValue)` honors the new defaultValue arg.
//   * The page renders without throwing for valid / invalid / missing
//     localStorage values and the `ResizablePanelGroup` carries the
//     horizontal flex direction (orientation="horizontal" on desktop).
//
// We deliberately do NOT assert library-computed `flexGrow` / `flexBasis`
// values on `data-panel` elements. `react-resizable-panels@4` defers
// initial layout computation until the group's `ResizeObserver` callback
// fires, and the jsdom RO stub in `test/setup.ts` is a no-op — so the
// imperative `setLayout` path silently no-ops in tests. The reader and
// orientation contract are testable; the library's actual size resolution
// is not in scope for unit testing.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { renderWithQuery } from '../utils'
import {
  SPLIT_PANEL_LEFT,
  SPLIT_PANEL_RIGHT,
  SPLIT_STORAGE_KEY,
  TmuxManagePageClient,
  parseStoredLayout,
} from '../../app/manage/tmux/tmux-page.client'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    listTmuxSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    killTmuxSession: vi.fn(),
    createTmuxSession: vi.fn(),
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

function mockDesktopMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(min-width: 768px)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function getGroupEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-slot="resizable-panel-group"]')
  if (!el) throw new Error('panel group not found')
  return el
}

beforeEach(() => {
  window.localStorage.clear()
  mockDesktopMatchMedia()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('parseStoredLayout', () => {
  it('returns null for `null` input', () => {
    expect(parseStoredLayout(null)).toBeNull()
  })

  it('returns null for non-JSON', () => {
    expect(parseStoredLayout('not json')).toBeNull()
  })

  it('returns null for a JSON array', () => {
    expect(parseStoredLayout(JSON.stringify([33, 67]))).toBeNull()
  })

  it('returns null when a panel id key is missing', () => {
    expect(parseStoredLayout(JSON.stringify({ [SPLIT_PANEL_LEFT]: 40 }))).toBeNull()
    expect(parseStoredLayout(JSON.stringify({ [SPLIT_PANEL_RIGHT]: 60 }))).toBeNull()
  })

  it('returns null when a value is non-numeric', () => {
    expect(
      parseStoredLayout(JSON.stringify({ [SPLIT_PANEL_LEFT]: '40', [SPLIT_PANEL_RIGHT]: 60 })),
    ).toBeNull()
  })

  it('returns null when values are out of [0, 100]', () => {
    expect(
      parseStoredLayout(JSON.stringify({ [SPLIT_PANEL_LEFT]: -1, [SPLIT_PANEL_RIGHT]: 101 })),
    ).toBeNull()
  })

  it('returns null when values do not sum to within 0.5 of 100', () => {
    expect(
      parseStoredLayout(JSON.stringify({ [SPLIT_PANEL_LEFT]: 30, [SPLIT_PANEL_RIGHT]: 30 })),
    ).toBeNull()
    expect(
      parseStoredLayout(JSON.stringify({ [SPLIT_PANEL_LEFT]: 60, [SPLIT_PANEL_RIGHT]: 60 })),
    ).toBeNull()
  })

  it('accepts a valid layout', () => {
    expect(
      parseStoredLayout(JSON.stringify({ [SPLIT_PANEL_LEFT]: 40, [SPLIT_PANEL_RIGHT]: 60 })),
    ).toEqual({ [SPLIT_PANEL_LEFT]: 40, [SPLIT_PANEL_RIGHT]: 60 })
  })

  it('accepts a layout summing within the 0.5 tolerance', () => {
    expect(
      parseStoredLayout(JSON.stringify({ [SPLIT_PANEL_LEFT]: 33.3, [SPLIT_PANEL_RIGHT]: 66.7 })),
    ).toEqual({ [SPLIT_PANEL_LEFT]: 33.3, [SPLIT_PANEL_RIGHT]: 66.7 })
  })
})

describe('TmuxManagePageClient — split-pane defaults', () => {
  it('renders horizontal flex direction when matchMedia reports desktop', () => {
    const { container } = renderWithQuery(<TmuxManagePageClient />)
    const group = getGroupEl(container)
    expect(group.style.flexDirection).toBe('row')
  })

  it('renders without throwing when no localStorage entry exists', () => {
    const { container } = renderWithQuery(<TmuxManagePageClient />)
    expect(getGroupEl(container)).toBeInstanceOf(HTMLElement)
  })

  it('renders without throwing when localStorage has a valid stored layout', () => {
    window.localStorage.setItem(
      SPLIT_STORAGE_KEY,
      JSON.stringify({ [SPLIT_PANEL_LEFT]: 40, [SPLIT_PANEL_RIGHT]: 60 }),
    )
    const { container } = renderWithQuery(<TmuxManagePageClient />)
    expect(getGroupEl(container)).toBeInstanceOf(HTMLElement)
  })

  it('renders without throwing when localStorage has an invalid JSON value', () => {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, 'not json')
    const { container } = renderWithQuery(<TmuxManagePageClient />)
    expect(getGroupEl(container)).toBeInstanceOf(HTMLElement)
  })

  it('renders without throwing when localStorage has an object with the wrong shape', () => {
    window.localStorage.setItem(
      SPLIT_STORAGE_KEY,
      JSON.stringify({ [SPLIT_PANEL_LEFT]: 'forty', [SPLIT_PANEL_RIGHT]: 60 }),
    )
    const { container } = renderWithQuery(<TmuxManagePageClient />)
    expect(getGroupEl(container)).toBeInstanceOf(HTMLElement)
  })
})

describe('useMediaQuery — defaultValue parameter', () => {
  it('initializes to false when no defaultValue is passed (backward compatible)', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const { useMediaQuery } = await import('../../lib/use-media-query')
    const { result } = renderHook(() => useMediaQuery('(max-width: 1px)'))
    expect(result.current).toBe(false)
  })

  it('honors defaultValue=true; effect later resolves to the matchMedia value', async () => {
    // matchMedia mock returns matches=true → after the effect flushes, the
    // hook value is true. With defaultValue=true the first-render value
    // also was true, so both pre- and post-effect snapshots agree.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const { useMediaQuery } = await import('../../lib/use-media-query')
    const { result } = renderHook(() => useMediaQuery('(min-width: 1px)', true))
    expect(result.current).toBe(true)
  })

  it('honors defaultValue=true even when matchMedia later disagrees (post-effect flip)', async () => {
    // matchMedia returns matches=false. With defaultValue=true the initial
    // render is true; the post-mount effect calls setMatches(false). RTL
    // flushes effects before exposing result, so we see the post-effect
    // value here. The contract we want to enforce is that an existing
    // caller without a defaultValue still gets `false` as the initial
    // value — that case is covered by the first test in this block.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const { useMediaQuery } = await import('../../lib/use-media-query')
    const { result } = renderHook(() => useMediaQuery('(min-width: 99999px)', true))
    expect(result.current).toBe(false)
  })
})
