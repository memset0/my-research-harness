'use client'

import type { ContentFields } from '@memon/core'
import { ChevronRight } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import type { ProjectTarget } from '../lib/api'
import { formatRelativeTime } from '../lib/format-relative-time'
import { cn } from '../lib/utils'
import { ContentBadges, ContentDetails } from './content-presentation'
import { TimestampLocal } from './timestamp'

/** "3h ago", rendered after hydration and refreshed every minute. */
function RelativeTime({ value }: { value: string | undefined }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  if (!value || now === null) return null
  const text = formatRelativeTime(value, now)
  if (!text) return null
  return (
    <span className="shrink-0 text-muted-foreground" title={value}>
      updated {text}
    </span>
  )
}

/**
 * The sticky header of a Report or Wiki page. The collapsed line shows the ID,
 * title, how long ago it changed and the badges; clicking anywhere on it
 * outside the actions toggles the full metadata. Actions sit on the right (an
 * HTML or service page puts its embed controls there).
 */
export function DocumentHeader({
  id,
  title,
  slug,
  updatedAt,
  createdAt,
  content,
  project,
  kind,
  actions,
}: {
  id: string
  title: string
  slug: string
  updatedAt: string | undefined
  createdAt?: string
  content: ContentFields
  project: ProjectTarget
  kind: 'wiki' | 'report'
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const toggle = () => setOpen((value) => !value)
  return (
    <div className="sticky top-0 z-10 shrink-0 border-b bg-background" data-document-header="">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the whole line is a mouse target; the leading button is the keyboard control. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the leading button handles keyboard toggling. */}
      <div
        className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5"
        onClick={toggle}
        data-document-header-line=""
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} details of ${id}`}
          onClick={(event) => {
            event.stopPropagation()
            toggle()
          }}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <span className="shrink-0 font-mono tabular-nums">{id}</span>
          <span className="min-w-0 truncate font-medium text-sm" title={title}>
            {title}
          </span>
          <RelativeTime value={updatedAt} />
          <span className="hidden shrink-0 md:flex">
            <ContentBadges content={content} />
          </span>
        </button>
        {actions && (
          // biome-ignore lint/a11y/noStaticElementInteractions: only stops the header toggle.
          // biome-ignore lint/a11y/useKeyWithClickEvents: only stops the header toggle.
          <div
            className="flex shrink-0 cursor-auto items-center gap-1.5"
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>
      {open && (
        <div
          className="space-y-2 border-t px-4 py-2 text-xs text-muted-foreground"
          data-document-details=""
        >
          <div className="md:hidden">
            <ContentBadges content={content} />
          </div>
          {content.description && <p className="text-foreground/80">{content.description}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>Slug</dt>
            <dd className="font-mono">{slug}</dd>
            {createdAt && (
              <>
                <dt>Created</dt>
                <dd>
                  <TimestampLocal value={createdAt} />
                </dd>
              </>
            )}
            <dt>Updated</dt>
            <dd>
              <TimestampLocal value={updatedAt} />
            </dd>
          </dl>
          <ContentDetails content={content} project={project} kind={kind} id={id} />
        </div>
      )}
    </div>
  )
}
