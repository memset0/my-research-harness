'use client'

import type { ContentFields } from '@memon/core'
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { ProjectTarget } from '../lib/api'
import { cn } from '../lib/utils'
import { ContentBadges, ContentDetails, hasContentDetails } from './content-presentation'
import { Button } from './ui/button'

/**
 * The sticky header of a Report or Wiki page: identity, time and badges on one
 * line, a Details toggle for the remaining metadata, and the page actions on
 * the right (an HTML or service page puts its embed controls there).
 */
export function DocumentHeader({
  identity,
  content,
  project,
  kind,
  id,
  actions,
}: {
  identity: ReactNode
  content: ContentFields
  project: ProjectTarget
  kind: 'wiki' | 'report'
  id: string
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const details = hasContentDetails(content)
  return (
    <div
      className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur"
      data-document-header=""
    >
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <div className="flex min-w-0 items-baseline gap-2">{identity}</div>
          <ContentBadges content={content} />
          {details && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              Details
              <ChevronDown
                aria-hidden
                className={cn('size-3.5 transition-transform', open && 'rotate-180')}
              />
            </Button>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {details && open && (
        <div className="border-t px-4 py-2" data-document-details="">
          <ContentDetails content={content} project={project} kind={kind} id={id} />
        </div>
      )}
    </div>
  )
}
