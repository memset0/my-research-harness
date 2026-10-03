'use client'

// Composition over forking: the shadcn Checkbox (CLI-owned) shows a check for
// both checked and indeterminate states, so the indeterminate state hides
// that check and overlays a minus here instead of changing ui/checkbox.tsx.

import { Minus } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'
import { Checkbox } from '../ui/checkbox'

export type TriState = boolean | 'indeterminate'

export function TriStateCheckbox({
  checked,
  className,
  ...props
}: Omit<ComponentProps<typeof Checkbox>, 'checked'> & { checked: TriState }) {
  const indeterminate = checked === 'indeterminate'
  return (
    <span className="relative inline-flex shrink-0" data-tri-state={String(checked)}>
      <Checkbox
        checked={checked}
        className={cn(
          indeterminate &&
            'border-primary bg-primary text-primary-foreground [&_[data-slot=checkbox-indicator]_svg]:hidden',
          className,
        )}
        {...props}
      />
      {indeterminate && (
        <Minus
          aria-hidden
          className="pointer-events-none absolute inset-0 m-auto size-3 text-primary-foreground"
        />
      )}
    </span>
  )
}
