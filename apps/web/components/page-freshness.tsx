'use client'

// Bottom-left footer readout: how old the oldest dependency of everything on
// this page is, plus what the file store is currently doing about it.
//
// Deliberately conservative wording. The number is the oldest *successful
// observation* among the files and directories this page read — including
// successful "missing" and "empty" results — so it is a floor on staleness,
// not a guaranteed maximum age of the remote disk. When a dependency has
// never been observed the readout says so instead of quoting an optimistic
// age, and a failed refresh keeps the last successful age with an error mark.
//
// A `storage: local` project has none of that machinery: the request reads the
// filesystem itself, so there is no queue, no observation age and nothing to
// age out. For those pages the readout says the project is read directly and
// quotes no numbers — only a real error still shows.

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { cn } from '../lib/utils'
import { usePageResourceStatus, useResourceHeartbeat } from './resource-heartbeat-provider'

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export interface PageFreshnessProps {
  /** Project this page belongs to; named in the direct-read wording. */
  project: string
}

export function PageFreshness({ project }: PageFreshnessProps) {
  const status = usePageResourceStatus()
  const { refresh, refreshing, foreground, heartbeatMs, tick } = useResourceHeartbeat()
  // The shared heartbeat is also this label's clock: `tick` advances once per
  // pulse, so the age re-renders without a timer of its own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the heartbeat clock that refreshes now
  const now = useMemo(() => Date.now(), [tick])

  const age = status.oldestVerifiedAt === null ? null : formatAge(now - status.oldestVerifiedAt)
  const label = status.direct
    ? `reads ${project} directly`
    : status.resources === 0
      ? 'nothing read yet'
      : age === null
        ? 'checking dependencies'
        : `oldest check ${age} ago`

  const detail: string[] = []
  if (!status.direct) {
    if (status.incomplete && status.resources > 0) detail.push('partial')
    if (status.checking > 0) detail.push(`checking ${status.checking}`)
    if (status.queued > 0) detail.push(`${status.queued} queued`)
  }

  const title = [
    status.direct
      ? `${project} is configured storage: local — every dependency of this page was read from the filesystem inside the request, so there is no queue, cache or observation age.`
      : status.resources === 0
        ? 'No file dependencies observed for this page yet.'
        : `Oldest successful observation across ${status.resources} resource${status.resources === 1 ? '' : 's'} on this page.`,
    !status.direct && status.incomplete
      ? 'Some dependencies have no successful observation yet.'
      : null,
    status.error ? `Last error: ${status.error}` : null,
    foreground
      ? `Foreground heartbeat every ${Math.round(heartbeatMs / 100) / 10}s.`
      : 'Heartbeat paused — this tab is hidden or unfocused.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  return (
    <div
      data-slot="page-freshness"
      className="flex min-w-0 items-center gap-1.5"
      title={title}
      aria-live="off"
    >
      <button
        type="button"
        onClick={() => refresh('manual')}
        disabled={refreshing}
        aria-label="Check this page's files now"
        data-slot="page-freshness-refresh"
        className="inline-flex cursor-pointer items-center rounded p-1 hover:bg-accent hover:text-accent-foreground disabled:cursor-default disabled:opacity-60"
      >
        <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden />
      </button>
      <span
        className={cn('truncate', !foreground && 'text-muted-foreground/70')}
        data-page-freshness-age
      >
        {label}
      </span>
      {detail.length > 0 && (
        <span
          className="hidden truncate text-muted-foreground/70 sm:inline"
          data-page-freshness-detail
        >
          {detail.join(' · ')}
        </span>
      )}
      {status.error && (
        <span className="inline-flex items-center gap-1 text-destructive" data-page-freshness-error>
          <AlertTriangle className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">refresh failed</span>
        </span>
      )}
    </div>
  )
}
