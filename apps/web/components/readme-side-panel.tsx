'use client'

import { ChevronLeft, ChevronRight, X as XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { ReadmeEditorBody } from './readme-editor'
import { useReadmeEditor } from './readme-editor-context'
import { Button } from './ui/button'

const COLLAPSED_WIDTH = 32

export interface ReadmeSidePanelProps {
  path: string
  runId: string
}

/**
 * Desktop-only right-side panel hosting the README editor.
 * Mount inside a flex-row layout; the panel sticks to the viewport top via
 * `sticky` so it stays visible while the detail page scrolls.
 */
export function ReadmeSidePanel({ path, runId }: ReadmeSidePanelProps) {
  const { open, collapsed, width, setOpen, toggleCollapsed, setWidth } = useReadmeEditor()
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const asideRef = useRef<HTMLDivElement | null>(null)

  const onMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const delta = drag.startX - e.clientX
    const next = drag.startWidth + delta
    // Update DOM directly during drag for smoothness.
    if (asideRef.current) {
      const min = 320
      const max = Math.max(min, Math.floor(window.innerWidth * 0.5))
      const clamped = Math.min(max, Math.max(min, next))
      asideRef.current.style.width = `${clamped}px`
    }
  }, [])

  const onMouseUp = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.classList.remove('select-none', 'cursor-col-resize')
    if (asideRef.current) {
      const px = asideRef.current.getBoundingClientRect().width
      setWidth(px)
    }
  }, [onMouseMove, setWidth])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: width }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.classList.add('select-none', 'cursor-col-resize')
    },
    [width, onMouseMove, onMouseUp],
  )

  // Defensive cleanup on unmount.
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.classList.remove('select-none', 'cursor-col-resize')
    }
  }, [onMouseMove, onMouseUp])

  if (!open) return null

  if (collapsed) {
    return (
      <aside
        data-testid="readme-side-panel"
        data-state="collapsed"
        style={{ width: COLLAPSED_WIDTH }}
        className="flex h-full shrink-0 flex-col items-center justify-start gap-2 border-l bg-card py-2"
      >
        <button
          type="button"
          aria-label="Expand README editor"
          onClick={toggleCollapsed}
          className={cn(
            'flex h-full w-full flex-col items-center justify-start gap-2 py-2',
            'text-muted-foreground transition-colors hover:text-foreground',
          )}
        >
          <ChevronLeft className="size-3.5" />
          <span
            className="font-mono text-[0.625rem] tracking-wide uppercase"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            Edit README
          </span>
        </button>
      </aside>
    )
  }

  return (
    <aside
      ref={asideRef}
      data-testid="readme-side-panel"
      data-state="expanded"
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l bg-card"
    >
      {/* Drag handle straddling the panel's left border (8px hit area, 1px
          visible bar on hover/drag — sits half on the left content column,
          half on the panel, so it's grabbable from either side). */}
      <div
        data-testid="readme-side-panel-drag-handle"
        onMouseDown={onMouseDown}
        aria-hidden
        title="Drag to resize"
        className={cn(
          'group/resize absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize',
          'transition-colors hover:bg-primary/30 active:bg-primary/50',
        )}
      >
        <div
          className={cn(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2',
            'bg-primary opacity-0 transition-opacity',
            'group-hover/resize:opacity-100 group-active/resize:opacity-100',
          )}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ReadmeEditorBody
          path={path}
          runId={runId}
          onClose={() => setOpen(false)}
          containerKind="panel"
          toolbarTrailing={
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Collapse README editor"
                title="Collapse"
                onClick={toggleCollapsed}
              >
                <ChevronRight />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Close README editor"
                title="Close"
                onClick={() => setOpen(false)}
              >
                <XIcon />
              </Button>
            </>
          }
        />
      </div>
    </aside>
  )
}
