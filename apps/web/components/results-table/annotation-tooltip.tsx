'use client'

import type { ReactNode } from 'react'
import { Markdown } from '../markdown'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card'

/** Wraps `children` in a Markdown hover card when a description exists. */
export function AnnotationTooltip({
  description,
  label,
  children,
}: {
  description?: string
  label: string
  children: ReactNode
}) {
  if (description === undefined) return <>{children}</>
  return (
    <HoverCard openDelay={250} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] p-3"
        aria-label={label}
      >
        <Markdown className="max-w-none text-xs text-popover-foreground [&_p]:my-0">
          {description}
        </Markdown>
      </HoverCardContent>
    </HoverCard>
  )
}
