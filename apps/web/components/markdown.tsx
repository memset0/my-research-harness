'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/utils'

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        'prose-code:before:content-none prose-code:after:content-none',
        // Inline <code> as a badge-like chip.
        'prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5',
        'prose-code:font-normal prose-code:text-[0.85em] prose-code:text-foreground',
        // Reset the chip styles for code INSIDE <pre> (fenced blocks). The
        // selector `[&_pre_code]:...` has specificity 0,1,2 — strictly higher
        // than the prose-code utilities above (0,1,0) — so block code keeps
        // its own pre-level background, padding, and font-size.
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none',
        '[&_pre_code]:text-inherit [&_pre_code]:text-[1em]',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
