'use client'

import { useEffect, useState } from 'react'

export function TimestampLocal({
  value,
  variant = 'short',
}: {
  value: string | null | undefined
  variant?: 'short' | 'long'
}) {
  // Render server-side as the raw ISO string to avoid hydration mismatch on
  // a timezone-sensitive value, then upgrade in useEffect.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  if (!value) return <span className="text-xs text-muted-foreground/60">—</span>
  if (!hydrated) {
    return <span className="font-mono text-xs text-muted-foreground">{value}</span>
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    return <span className="font-mono text-xs text-muted-foreground">{value}</span>
  }
  const formatted =
    variant === 'long'
      ? d.toLocaleString()
      : d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' }) +
        ' ' +
        d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return (
    <span className="font-mono text-xs text-foreground/80" title={value}>
      {formatted}
    </span>
  )
}
