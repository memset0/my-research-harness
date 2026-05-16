'use client'

// Drag-to-resize handle for the desktop sidebar.
//
// Constraints (per CLAUDE.md F3 and the change's design.md):
//   - This file MUST NOT import or modify `components/ui/sidebar.tsx`.
//     It consumes the public `useSidebar()` context exposed by that file
//     and the `useIsMobile()` hook (re-exported indirectly via
//     `hooks/use-mobile.ts`) but NEVER changes the primitive.
//   - The handle is rendered only on viewports >= md (Tailwind's 768px)
//     and only when the sidebar is in the `expanded` (open) state. On
//     mobile or when collapsed, the handle returns null.
//
// Interaction model:
//   - During pointer drag, the handle writes the new width directly to
//     `document.documentElement.querySelector('[data-slot="sidebar-wrapper"]')`'s
//     inline style. This avoids re-rendering the entire React tree on
//     every pointermove (the CSS variable is consumed by
//     `w-(--sidebar-width)` Tailwind utilities, so direct DOM updates
//     are smooth).
//   - On pointerup, the final width is committed via `setWidthPx`,
//     which updates React state AND localStorage. The committed value
//     then survives reloads.
//   - Keyboard arrow / shift+arrow events bypass the DOM-write path
//     and call `setWidthPx` directly since they're discrete commits.

import * as React from 'react'
import { useSidebar } from './ui/sidebar'
import { useIsMobile } from '../hooks/use-mobile'
import {
  DEFAULT_PX,
  MAX_PX,
  MIN_PX,
  useSidebarWidth,
} from '../hooks/use-sidebar-width'
import { cn } from '../lib/utils'

const KB_STEP = 16
const KB_STEP_LARGE = 64

function clamp(n: number): number {
  return Math.max(MIN_PX, Math.min(MAX_PX, n))
}

/** Find the nearest `data-slot="sidebar-wrapper"` ancestor. SidebarProvider
 *  emits this element; both `--sidebar-width` and the layout column live
 *  there. */
function findWrapper(from: Element | null): HTMLElement | null {
  if (!from) {
    return document.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')
  }
  return from.closest<HTMLElement>('[data-slot="sidebar-wrapper"]')
}

export function SidebarResizeHandle({ className }: { className?: string }) {
  const { state } = useSidebar()
  const isMobile = useIsMobile()
  const { widthPx, setWidthPx } = useSidebarWidth()
  const handleRef = React.useRef<HTMLDivElement | null>(null)
  // Drag state lives in refs to avoid re-renders during pointermove.
  const dragStartXRef = React.useRef<number | null>(null)
  const dragStartWidthRef = React.useRef<number>(DEFAULT_PX)

  if (isMobile) return null
  if (state !== 'expanded') return null

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only respond to primary button / touch / pen primary contact.
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = widthPx
    e.preventDefault()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current == null) return
    const next = clamp(
      dragStartWidthRef.current + (e.clientX - dragStartXRef.current),
    )
    // Write directly to the wrapper's CSS variable — bypasses React state
    // for smooth dragging. The committed value lands in setWidthPx on
    // pointerup.
    const wrapper = findWrapper(e.currentTarget)
    if (wrapper) {
      wrapper.style.setProperty('--sidebar-width', `${next}px`)
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current == null) return
    const next = clamp(
      dragStartWidthRef.current + (e.clientX - dragStartXRef.current),
    )
    dragStartXRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer not captured (e.g. pointercancel raced) — ignore */
    }
    // Commit to React state + localStorage. The inline style we wrote
    // during drag will be overwritten by the SidebarProvider's `style`
    // prop on the next render (same value, no visible flicker).
    setWidthPx(next)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let delta = 0
    const step = e.shiftKey ? KB_STEP_LARGE : KB_STEP
    if (e.key === 'ArrowRight') delta = step
    else if (e.key === 'ArrowLeft') delta = -step
    else return
    e.preventDefault()
    setWidthPx(clamp(widthPx + delta))
  }

  return (
    <div
      ref={handleRef}
      data-slot="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      // Absolute-positioned thin vertical strip at the sidebar's right edge.
      // The handle sits inside `<AppSidebar>` which renders inside
      // `data-slot="sidebar"` — but the sidebar primitive's desktop column
      // is `position: fixed` to `inset-y-0 left-0 w-(--sidebar-width)`,
      // so positioning our handle at `right-0` aligns it with the column's
      // right edge. `inset-y-0` stretches it the full sidebar height.
      // `z-30` keeps it above the sidebar body (z-10) but below toasts.
      className={cn(
        'absolute inset-y-0 right-0 z-30 hidden w-1 cursor-col-resize touch-none select-none transition-colors md:block',
        'bg-sidebar-border/60 hover:bg-primary/50 active:bg-primary/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
    />
  )
}
