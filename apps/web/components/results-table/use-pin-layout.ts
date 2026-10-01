'use client'

import { type RefObject, useLayoutEffect, useState } from 'react'
import {
  computePinLayout,
  EMPTY_PIN_LAYOUT,
  samePinLayout,
} from '../../lib/experiment-results/layout'
import type { PinLayout } from '../../lib/experiment-results/types'

/**
 * Measures pinned header widths (`thead [data-column-id][data-pinned]`) and
 * keeps sticky offsets current across resizes. `layoutKey` must change when
 * pin side, pin order or the visible column set changes.
 */
export function usePinLayout(
  tableRef: RefObject<HTMLTableElement | null>,
  layoutKey: string,
): PinLayout {
  const [pinLayout, setPinLayout] = useState<PinLayout>(EMPTY_PIN_LAYOUT)

  useLayoutEffect(() => {
    void layoutKey
    const table = tableRef.current
    const container = table?.parentElement
    if (!table || !container) return

    const headers = () => Array.from(table.querySelectorAll<HTMLElement>('thead [data-column-id]'))
    const measure = () => {
      const next = computePinLayout(
        headers().flatMap((header) => {
          const side = header.dataset.pinned
          const columnId = header.dataset.columnId
          if ((side !== 'left' && side !== 'right') || !columnId) return []
          return [{ columnId, side, width: header.getBoundingClientRect().width }] as const
        }),
        container.clientWidth,
      )
      setPinLayout((current) => (samePinLayout(current, next) ? current : next))
    }

    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(container)
    for (const header of headers()) observer?.observe(header)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [layoutKey, tableRef])

  return pinLayout
}
