'use client'

// Expanded HTML view of full Report and Wiki bundle pages.
//
// The state lives in the `expanded=1` URL parameter so a reload keeps it: the
// URL is replaced through the native History API (which Next mirrors into
// `useSearchParams` only for state without its own `__NA` marker, so pass
// null and let Next copy its internal state), never pushed, without scrolling or navigating, and other
// parameters and the fragment are preserved. Bundle pages hand it to their
// embed's own Expand.

import { useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

export function useExpandedInUrl(): {
  expanded: boolean
  setExpanded: (expanded: boolean) => void
} {
  const searchParams = useSearchParams()
  const expanded = searchParams?.get('expanded') === '1'
  const setExpanded = useCallback((next: boolean) => {
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('expanded', '1')
    else url.searchParams.delete('expanded')
    window.history.replaceState(null, '', url)
  }, [])
  return { expanded, setExpanded }
}
