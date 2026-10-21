'use client'

// Expanded (focused) viewing for full Report and Wiki pages.
//
// The state lives in the `expanded=1` URL parameter so a reload keeps it: the
// URL is replaced through the native History API (which Next mirrors into
// `useSearchParams`), never pushed, without scrolling or navigating, and other
// parameters and the fragment are preserved. HTML bundle pages hand it to
// their embed's own Expand; Markdown pages turn their whole pane into a
// full-window layer.

import { Maximize2, Minimize2 } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect } from 'react'
import { Button } from './ui/button'

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
    window.history.replaceState(window.history.state, '', url)
  }, [])
  return { expanded, setExpanded }
}

/** Classes that lift an expanded page pane over the whole application window. */
export const EXPANDED_PANE_CLASS = 'fixed inset-0 z-50 bg-background'

/** While `active`, lock background scrolling and let Escape call `onExit`. */
export function useFocusedPane(active: boolean, onExit: () => void): void {
  useEffect(() => {
    if (!active) return
    const body = document.body
    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onExit()
    }
    window.addEventListener('keydown', exitOnEscape)
    return () => {
      body.style.overflow = previousOverflow
      window.removeEventListener('keydown', exitOnEscape)
    }
  }, [active, onExit])
}

export function ExpandViewButton({
  expanded,
  onToggle,
}: {
  expanded: boolean
  onToggle: () => void
}) {
  const label = expanded ? 'Exit expanded view' : 'Expand'
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={label}
      aria-pressed={expanded}
      title={label}
      onClick={onToggle}
      data-expand-view=""
    >
      {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}
