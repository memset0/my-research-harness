// Client-side hook for the persisted desktop sidebar width.
//
// The width is stored in localStorage under `memon:sidebar:width` as a
// string-encoded integer (pixels). SSR uses DEFAULT_PX so the very first
// paint matches the shadcn primitive's default 16rem; the persisted value
// (if any) is applied via a useEffect after hydration.
//
// Out-of-range / non-numeric stored values are silently coerced to the
// nearest bound or to DEFAULT_PX respectively. Writes are best-effort:
// quota / private-mode errors are swallowed.
//
// Constants are duplicated in `sidebar-resize-handle.tsx` for the drag
// clamp; the contract that both sites agree on the numbers is enforced by
// the unit tests in this file and the resize handle's test.

import * as React from 'react'

export const MIN_PX = 192 // 12rem at root font size 16px
export const MAX_PX = 384 // 24rem
export const DEFAULT_PX = 256 // 16rem (matches shadcn SIDEBAR_WIDTH)

export const STORAGE_KEY = 'memon:sidebar:width'

/** Parse a string from localStorage to a clamped pixel width. Returns
 *  `null` when the value is missing / unparseable so the caller can fall
 *  back to the SSR default cleanly. */
export function parseStoredWidth(raw: string | null): number | null {
  if (raw == null) return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return null
  if (Number.isNaN(n)) return null
  // Bare-number check: reject `"abc"` etc. parseInt("abc",10) returns NaN
  // (handled above), parseInt("12abc",10) returns 12 — we accept that
  // since the value is a plain integer.
  if (n < MIN_PX) return MIN_PX
  if (n > MAX_PX) return MAX_PX
  return n
}

export interface UseSidebarWidth {
  widthPx: number
  setWidthPx: (n: number) => void
}

export function useSidebarWidth(): UseSidebarWidth {
  // SSR-stable initial value. The persisted value is read after mount
  // (next effect tick) so the server and the first client render produce
  // identical HTML for hydration. Inline CSS variable strings don't
  // trigger React's hydration mismatch check.
  const [widthPx, setWidthPxState] = React.useState<number>(DEFAULT_PX)

  React.useEffect(() => {
    try {
      const parsed = parseStoredWidth(localStorage.getItem(STORAGE_KEY))
      if (parsed != null) setWidthPxState(parsed)
    } catch {
      /* private mode / disabled storage — keep default */
    }
  }, [])

  const setWidthPx = React.useCallback((next: number) => {
    const clamped = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(next)))
    setWidthPxState(clamped)
    try {
      localStorage.setItem(STORAGE_KEY, String(clamped))
    } catch {
      /* swallow quota / private-mode errors */
    }
  }, [])

  return { widthPx, setWidthPx }
}
