// Composition over forking: shadcn's Badge ships only default/secondary/
// destructive/outline/ghost/link variants. For our domain ("warning",
// "success"), we wrap Badge with a className override rather than editing
// badge.tsx — keeping the shadcn component pristine and CLI-overwrite-safe.

import * as React from 'react'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'

export const WarningBadge = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<typeof Badge>
>(function WarningBadge({ className, variant: _variant, ...props }, _ref) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-200',
        className,
      )}
      {...props}
    />
  )
})

export const SuccessBadge = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<typeof Badge>
>(function SuccessBadge({ className, variant: _variant, ...props }, _ref) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-200',
        className,
      )}
      {...props}
    />
  )
})
