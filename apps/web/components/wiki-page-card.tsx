'use client'

// Rail / Sheet / quick-switcher entry for one wiki page, plus the three
// independent signal badges (status, staleness, review) the wiki surface
// shows everywhere a page is listed.

import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import type { ReviewState } from '@memon/core'
import type { WikiListItem } from '../lib/api'
import { formatRelativeTime } from '../lib/format-relative-time'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'

// Canonical kind order, inlined rather than imported from @memon/core:
// client bundles must not pull the core runtime (it transitively imports
// fast-glob → fs). Mirrors WIKI_KINDS.
export const WIKI_KIND_ORDER = [
  'meeting',
  'finding',
  'bottleneck',
  'showcase',
  'question',
  'decision',
  'note',
  'harness-feedback',
] as const

const REVIEW_LABEL: Record<ReviewState, string> = {
  VERIFIED: 'VERIFIED',
  CHANGED_SINCE_VERIFY: 'CHANGED_SINCE_VERIFY',
  UNVERIFIED: 'UNVERIFIED',
}

const REVIEW_DESCRIPTION: Record<ReviewState, string> = {
  VERIFIED: 'every line is covered by the verified wiki-commit prefix',
  CHANGED_SINCE_VERIFY: 'edited after the last verified wiki commit',
  UNVERIFIED: 'no line is covered by a verified wiki commit',
}

// Distinct treatment per value using semantic tokens only, so both themes
// resolve without hard-coded colours.
const REVIEW_CLASS: Record<ReviewState, string> = {
  VERIFIED: 'border-primary/50 bg-primary/10 text-primary',
  CHANGED_SINCE_VERIFY: 'border-ring bg-accent text-accent-foreground',
  UNVERIFIED: 'border-dashed border-muted-foreground/40 text-muted-foreground',
}

export function WikiKindBadge({ kind, className }: { kind: string; className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn('shrink-0 font-mono text-[10px] lowercase', className)}
      data-slot="wiki-kind-badge"
      data-kind={kind}
    >
      {kind}
    </Badge>
  )
}

export function WikiStatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  return (
    <Badge
      variant="outline"
      className="shrink-0 text-[10px] tracking-wide"
      data-slot="wiki-status-badge"
      data-status={status}
    >
      {status}
    </Badge>
  )
}

export function WikiStaleIndicator({
  stale,
  staleSources,
}: {
  stale: boolean
  staleSources: readonly string[]
}) {
  if (!stale) return null
  const sources = staleSources.length > 0 ? staleSources.join(', ') : 'a cited artifact'
  const label = `stale — newer evidence in ${sources}`
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded border border-ring bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground"
      data-slot="wiki-stale-indicator"
      title={label}
    >
      <AlertTriangle className="size-3" aria-hidden />
      <span aria-hidden>stale</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function WikiReviewBadge({
  state,
  verifiedAt,
}: {
  state: ReviewState | null | undefined
  verifiedAt?: string | null
}) {
  if (!state) return null
  const description = verifiedAt
    ? `${REVIEW_DESCRIPTION[state]} (verified ${verifiedAt})`
    : REVIEW_DESCRIPTION[state]
  return (
    <Badge
      variant="outline"
      className={cn('shrink-0 font-mono text-[10px]', REVIEW_CLASS[state])}
      data-slot="wiki-review-badge"
      data-review-state={state}
      title={description}
    >
      <span aria-hidden>{REVIEW_LABEL[state]}</span>
      <span className="sr-only">
        review state {REVIEW_LABEL[state]}: {description}
      </span>
    </Badge>
  )
}

/**
 * The list projection carries the full deprecation object; the Experiment
 * backlink projection carries only the flag, so both are accepted.
 */
export function WikiDeprecatedBadge({
  deprecated,
}: {
  deprecated: WikiListItem['deprecated'] | boolean
}) {
  if (!deprecated) return null
  const label =
    deprecated === true
      ? 'deprecated'
      : `deprecated ${deprecated.at}: ${deprecated.reason}`
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-destructive/50 text-[10px] text-destructive"
      data-slot="wiki-deprecated-badge"
      title={label}
    >
      <span aria-hidden>deprecated</span>
      <span className="sr-only">{label}</span>
    </Badge>
  )
}

/** `updatedAt` descending, deprecated pages last in the same relative order. */
export function sortWikiPages(pages: readonly WikiListItem[]): WikiListItem[] {
  return [...pages].sort((a, b) => {
    const deprecatedDelta = Number(!!a.deprecated) - Number(!!b.deprecated)
    if (deprecatedDelta !== 0) return deprecatedDelta
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)
  })
}

/** Case-insensitive substring match over title, slug, and tags. */
export function filterWikiPages(
  pages: readonly WikiListItem[],
  { kind, text }: { kind: string; text: string },
): WikiListItem[] {
  const needle = text.trim().toLowerCase()
  return pages.filter((page) => {
    if (kind !== 'all' && page.kind !== kind) return false
    if (needle === '') return true
    return (
      page.title.toLowerCase().includes(needle) ||
      page.slug.toLowerCase().includes(needle) ||
      page.tags.some((tag) => tag.toLowerCase().includes(needle))
    )
  })
}

export function WikiPageCard({
  page,
  href,
  active,
  onSelect,
}: {
  page: WikiListItem
  href: string
  active: boolean
  onSelect?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      data-wiki-card=""
      data-wiki-id={page.id}
      className={cn(
        'block rounded-md border border-border bg-card p-2.5 text-xs transition-colors',
        'hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        active && 'border-primary bg-primary/5',
      )}
    >
      <div className="flex flex-wrap items-center gap-1">
        <WikiKindBadge kind={page.kind} />
        <WikiStatusBadge status={page.status} />
        <WikiStaleIndicator stale={page.stale} staleSources={page.staleSources} />
        <WikiReviewBadge state={page.review?.state} verifiedAt={page.review?.verifiedAt} />
        <WikiDeprecatedBadge deprecated={page.deprecated} />
      </div>
      <div className="mt-1 truncate text-[13px] font-medium text-foreground">
        {page.title || <span className="italic text-muted-foreground/60">(no title)</span>}
      </div>
      {page.description && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {page.description}
        </p>
      )}
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="font-mono tabular-nums">{page.id}</span>
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate font-mono">{page.slug}</span>
        <span aria-hidden>·</span>
        <span title={page.updatedAt}>{formatRelativeTime(page.updatedAt)}</span>
      </div>
    </Link>
  )
}
