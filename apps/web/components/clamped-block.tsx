'use client'

// Shared "clamp tall content to N lines, fade it out, click to expand"
// primitive. Used by the experiment detail page for long Markdown section
// bodies, for the managed Implementation / Investigation cards, and for the
// Success criteria blocks inside them.
//
// Height budget is expressed in LINES, not pixels, and realised with the CSS
// `lh` unit (`max-height: 10lh`). That keeps the collapsed height correct for
// whatever font-size / line-height the surrounding surface uses, and — unlike
// a measured pixel budget — it is right on the very first paint, so there is
// no flash of fully-expanded content before an effect runs.
//
// The fade is a `mask-image` on the clamp box, NOT a coloured gradient
// overlay. A gradient would have to know the exact surface colour behind it
// (card vs. muted/20 vs. tinted callout) and reads as a visible band whenever
// it guesses wrong; a mask fades the content itself to transparent and is
// therefore background-agnostic.
//
// Overflow detection needs the DOM: a ResizeObserver compares the content's
// scrollHeight against the clamp box's clientHeight. Until that first
// measurement lands the affordance stays hidden, so a short block never
// flickers a "Show more" button it does not need.

import { ChevronDown } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils'

export interface ClampedBlockProps {
  children: ReactNode
  /**
   * Collapsed height budget in lines of the content's own line-height.
   * 10 for ordinary prose sections, 20 for the denser managed cards.
   */
  lines: number
  /** Accessible noun for the control, e.g. "Motivation" → "Expand Motivation". */
  label: string
  className?: string
  contentClassName?: string
}

/** Collapse animation length; also gates when max-height may go auto. */
const TRANSITION_MS = 260

export function ClampedBlock({
  children,
  lines,
  label,
  className,
  contentClassName,
}: ClampedBlockProps) {
  const clampRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // While true the expanded box drops its max-height entirely, so nested
  // content that grows later (an inner clamp expanding, an image loading)
  // is not silently cut off by a stale pixel height.
  const [settled, setSettled] = useState(false)
  const [contentHeight, setContentHeight] = useState(0)

  useLayoutEffect(() => {
    const clamp = clampRef.current
    const content = contentRef.current
    if (!clamp || !content) return
    const measure = () => {
      // Measure the clamp box, NOT the content div. The content's own outer
      // margins escape its scrollHeight but still occupy the clamp box, so
      // measuring the child under-reports by the margin (observed: 460 vs
      // 468) and the expand animation ends on a visible 8px jump.
      const full = clamp.scrollHeight
      setContentHeight(full)
      // clientHeight is the collapsed budget while collapsed. Once expanded
      // the box is already full height, so keep the previous verdict rather
      // than thrashing the affordance off.
      if (!expanded) setOverflowing(full - clamp.clientHeight > 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    observer.observe(clamp)
    return () => observer.disconnect()
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    const timer = window.setTimeout(() => setSettled(true), TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [expanded])

  const collapse = useCallback(() => {
    // Re-pin the pixel height first; animating from `max-height: none` back
    // to a pixel value does not transition.
    setSettled(false)
    requestAnimationFrame(() => setExpanded(false))
  }, [])

  const collapsed = !expanded
  const maxHeight = expanded ? (settled ? undefined : `${contentHeight}px`) : `${lines}lh`

  return (
    <div
      className={cn('relative', className)}
      data-clamped={overflowing ? '' : undefined}
      data-clamp-expanded={overflowing && expanded ? '' : undefined}
    >
      <div
        ref={clampRef}
        className={cn(
          'overflow-hidden transition-[max-height] duration-[260ms] ease-out motion-reduce:transition-none',
          overflowing &&
            collapsed &&
            '[mask-image:linear-gradient(to_bottom,black_calc(100%-3.5rem),transparent)]',
        )}
        style={{ maxHeight }}
      >
        <div ref={contentRef} className={contentClassName}>
          {children}
        </div>
      </div>

      {overflowing && collapsed && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label={`Expand ${label}`}
          data-clamp-expand
          className="absolute inset-x-0 bottom-0 flex h-14 cursor-pointer items-end justify-center"
        >
          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
            Show more
            <ChevronDown className="size-3" aria-hidden />
          </span>
        </button>
      )}

      {overflowing && expanded && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={collapse}
            aria-expanded
            aria-label={`Collapse ${label}`}
            data-clamp-collapse
            className="flex cursor-pointer items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            Show less
            <ChevronDown className="size-3 rotate-180" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
