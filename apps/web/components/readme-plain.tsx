'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface ReadmePlainProps {
  value: string
  onChange: (next: string) => void
  className?: string
}

/**
 * Bare-bones <textarea> fallback for the README editor. No syntax highlighting,
 * no line numbers, just monospace text. Used either by user opt-in (toolbar
 * toggle) or as automatic fallback when Monaco fails to load.
 */
export const ReadmePlain = forwardRef<HTMLTextAreaElement, ReadmePlainProps>(
  function ReadmePlain({ value, onChange, className }, ref) {
    return (
      <textarea
        ref={ref}
        data-testid="readme-plain-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(
          'h-full w-full resize-none border-0 bg-transparent p-3 font-mono text-xs leading-relaxed outline-none',
          'focus-visible:ring-0',
          className,
        )}
      />
    )
  },
)
