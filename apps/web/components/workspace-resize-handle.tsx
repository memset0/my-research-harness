'use client'

import * as React from 'react'
import {
  clampWorkspacePanelWidth,
  getWorkspacePanelBounds,
  type WorkspacePanelSurface,
} from '../hooks/use-workspace-panel-width'
import { cn } from '../lib/utils'

const KB_STEP = 16
const KB_STEP_LARGE = 64

export interface WorkspaceResizeHandleProps {
  surface: WorkspacePanelSurface
  widthPx: number
  setWidthPx: (width: number) => void
  /** Width of the actual split outlet; drawers continue to use the viewport. */
  availableWidth?: number
  /** Accessible noun for the content occupying the shared surface. */
  label?: string
  className?: string
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1200 : window.innerWidth
}

function findPanel(from: Element): HTMLElement | null {
  return from.closest<HTMLElement>('[data-slot="workspace-panel"]')
}

export function WorkspaceResizeHandle({
  surface,
  widthPx,
  setWidthPx,
  availableWidth,
  label = 'workspace panel',
  className,
}: WorkspaceResizeHandleProps) {
  const dragStartXRef = React.useRef<number | null>(null)
  const dragStartWidthRef = React.useRef(widthPx)
  const liveWidthRef = React.useRef(widthPx)
  const draggedPanelRef = React.useRef<HTMLElement | null>(null)
  const removeWindowListenersRef = React.useRef<(() => void) | null>(null)
  const widthBasis =
    surface === 'split' && availableWidth !== undefined && availableWidth > 0
      ? availableWidth
      : viewportWidth()
  const bounds = getWorkspacePanelBounds(surface, widthBasis)

  React.useEffect(
    () => () => {
      removeWindowListenersRef.current?.()
    },
    [],
  )

  const updateDrag = (clientX: number) => {
    if (dragStartXRef.current == null) return
    const next = clampWorkspacePanelWidth(
      dragStartWidthRef.current + dragStartXRef.current - clientX,
      surface,
      widthBasis,
    )
    liveWidthRef.current = next
    if (draggedPanelRef.current) draggedPanelRef.current.style.width = `${next}px`
  }

  const finishDrag = () => {
    if (dragStartXRef.current == null) return
    dragStartXRef.current = null
    draggedPanelRef.current = null
    removeWindowListenersRef.current?.()
    setWidthPx(liveWidthRef.current)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const panel = findPanel(event.currentTarget)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragStartXRef.current = event.clientX
    dragStartWidthRef.current = panel?.getBoundingClientRect().width || widthPx
    liveWidthRef.current = dragStartWidthRef.current
    draggedPanelRef.current = panel

    removeWindowListenersRef.current?.()
    const root = document.documentElement
    const previousCursor = root.style.cursor
    const previousUserSelect = root.style.userSelect
    root.style.cursor = 'col-resize'
    root.style.userSelect = 'none'
    const handlePointerMove = (nativeEvent: PointerEvent) => updateDrag(nativeEvent.clientX)
    const handlePointerEnd = () => finishDrag()
    const removeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerEnd, true)
      window.removeEventListener('pointercancel', handlePointerEnd, true)
      root.style.cursor = previousCursor
      root.style.userSelect = previousUserSelect
      if (removeWindowListenersRef.current === removeListeners) {
        removeWindowListenersRef.current = null
      }
    }
    removeWindowListenersRef.current = removeListeners
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerEnd, true)
    window.addEventListener('pointercancel', handlePointerEnd, true)
    event.preventDefault()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? KB_STEP_LARGE : KB_STEP
    let delta = 0
    if (event.key === 'ArrowLeft') delta = step
    else if (event.key === 'ArrowRight') delta = -step
    else return
    event.preventDefault()
    setWidthPx(clampWorkspacePanelWidth(widthPx + delta, surface, widthBasis))
  }

  return (
    <hr
      data-slot="workspace-resize-handle"
      data-surface={surface}
      aria-orientation="vertical"
      aria-label={`Resize ${label} ${surface}`}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={Math.round(widthPx)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        'group absolute inset-y-0 left-0 z-[60] hidden w-4 -translate-x-1/2 cursor-col-resize touch-none select-none border-0 p-0 md:block',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border',
        'hover:after:w-0.5 hover:after:bg-primary/60 active:after:w-0.5 active:after:bg-primary',
        className,
      )}
    />
  )
}
