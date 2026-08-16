'use client'

import { cn } from '../lib/utils'
import { TimestampLocal } from './timestamp'
import { Badge } from './ui/badge'

export function FrontmatterPanel({
  data,
  className,
  timestampKeys = [],
}: {
  data: Record<string, unknown>
  className?: string
  timestampKeys?: readonly string[]
}) {
  const entries = Object.entries(data)
  const timestampKeySet = new Set(timestampKeys)
  if (entries.length === 0) return null
  return (
    <dl
      className={cn(
        'mb-4 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b pb-3 text-xs',
        className,
      )}
      data-slot="frontmatter-panel"
    >
      {entries.map(([key, value]) => (
        <FrontmatterRow key={key} k={key} v={value} formatTimestamp={timestampKeySet.has(key)} />
      ))}
    </dl>
  )
}

function FrontmatterRow({
  k,
  v,
  formatTimestamp,
}: {
  k: string
  v: unknown
  formatTimestamp: boolean
}) {
  return (
    <>
      <dt className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {k}
      </dt>
      <dd className="min-w-0 break-words">
        <FrontmatterValue value={v} formatTimestamp={formatTimestamp} />
      </dd>
    </>
  )
}

function FrontmatterValue({
  value,
  formatTimestamp,
}: {
  value: unknown
  formatTimestamp: boolean
}) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground/40">—</span>
  }
  if (formatTimestamp) {
    const timestamp = normalizeIsoTimestamp(value)
    if (timestamp !== null) {
      return <TimestampLocal value={timestamp} variant="long" />
    }
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground/40">—</span>
    }
    return (
      <div className="flex flex-wrap items-center gap-1">
        {value.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: frontmatter arrays are static display values without item identities.
          <Badge key={i} variant="secondary" className="font-mono text-[10px]">
            {formatScalar(item)}
          </Badge>
        ))}
      </div>
    )
  }
  if (typeof value === 'object') {
    return <span className="font-mono text-muted-foreground">{JSON.stringify(value)}</span>
  }
  return <span className="font-mono">{formatScalar(value)}</span>
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

function normalizeIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value !== 'string' || !ISO_DATE_TIME.test(value)) return null
  return Number.isNaN(new Date(value).getTime()) ? null : value
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
