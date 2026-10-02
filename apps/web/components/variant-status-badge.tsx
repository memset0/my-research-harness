// Composition over forking: Variant statuses get their colours by wrapping
// shadcn's Badge with a per-status className, never by adding variants to
// ui/badge.tsx (which the shadcn CLI owns).

import type { VariantStatus } from '@memon/core'
import type * as React from 'react'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'

/**
 * One distinct style per status, light and dark. `BLOCKED` (planned but
 * waiting on a prerequisite) is orange with a dashed outline so it reads apart
 * from `FAILED` (red) and `INCONCLUSIVE` (amber) without relying on colour.
 */
export const VARIANT_STATUS_CLASS: Readonly<Record<VariantStatus, string>> = {
  PLANNED:
    'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700/50 dark:bg-slate-900/50 dark:text-slate-300',
  BLOCKED:
    'border-dashed border-orange-400 bg-orange-50 text-orange-800 dark:border-orange-600/60 dark:bg-orange-950/40 dark:text-orange-200',
  RUNNING:
    'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/50 dark:bg-sky-950/50 dark:text-sky-200',
  COMPLETED:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-200',
  FAILED:
    'border-red-300 bg-red-50 text-red-800 dark:border-red-700/50 dark:bg-red-950/40 dark:text-red-200',
  INCONCLUSIVE:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200',
  DROPPED:
    'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700/50 dark:bg-stone-900/50 dark:text-stone-300',
}

export type VariantStatusBadgeProps = Omit<
  React.ComponentProps<typeof Badge>,
  'variant' | 'children'
> & {
  status: VariantStatus
}

/** The status name in an outline Badge; an unknown status keeps the plain outline. */
export function VariantStatusBadge({ status, className, ...props }: VariantStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      data-status={status}
      className={cn('font-medium', VARIANT_STATUS_CLASS[status], className)}
      {...props}
    >
      {status}
    </Badge>
  )
}
