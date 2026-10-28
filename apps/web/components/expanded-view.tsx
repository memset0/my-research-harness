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
import { useCallback, useState } from 'react'
import { embedFrameSrc, pageUrlForFrame } from '../lib/embed-location'

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

/**
 * Mirror an embedded document's location (`view` parameter and fragment) in
 * the page URL: the frame starts where the page URL points, and in-document
 * navigation replaces the page URL the same way `expanded` does.
 */
export function useEmbedLocationInUrl(src: string): {
  frameSrc: string
  onFrameLocation: (href: string) => void
} {
  // Fixed for the mounted frame: a changing src attribute would reload it.
  const [frameSrc] = useState(() =>
    typeof window === 'undefined' ? src : embedFrameSrc(src, new URL(window.location.href)),
  )
  const onFrameLocation = useCallback(
    (href: string) => {
      const next = pageUrlForFrame(src, href, new URL(window.location.href))
      if (next && next.href !== window.location.href) window.history.replaceState(null, '', next)
    },
    [src],
  )
  return { frameSrc, onFrameLocation }
}
