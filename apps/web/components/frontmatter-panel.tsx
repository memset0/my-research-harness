'use client'

import { Badge } from './ui/badge'
import { cn } from '../lib/utils'

export function FrontmatterPanel({
  data,
  className,
}: {
  data: Record<string, unknown>
  className?: string
}) {
  const entries = Object.entries(data)
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
        <FrontmatterRow key={key} k={key} v={value} />
      ))}
    </dl>
  )
}

function FrontmatterRow({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <dt className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {k}
      </dt>
      <dd className="min-w-0 break-words">
        <FrontmatterValue value={v} />
      </dd>
    </>
  )
}

function FrontmatterValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground/40">—</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground/40">—</span>
    }
    return (
      <div className="flex flex-wrap items-center gap-1">
        {value.map((item, i) => (
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

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
