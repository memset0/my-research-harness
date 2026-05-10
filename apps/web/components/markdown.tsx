'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/utils'

// Force every `<input type="checkbox">` produced by remark-gfm's task-list
// plugin to be `disabled`. v1 of the experiment doc Plan section is
// read-only; toggling happens via the Edit markdown dialog. This override
// guards against future remark-gfm versions that might emit interactive
// checkboxes by default.
const COMPONENTS: Components = {
  input: ({ node: _node, type, checked, ...rest }) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={!!checked}
          disabled
          readOnly
          aria-readonly="true"
          {...rest}
        />
      )
    }
    return <input type={type} {...rest} />
  },
}

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
        // GFM task list rendering: remove the bullet marker on items that
        // contain a checkbox so the checkbox itself is the leading glyph,
        // and give the disabled checkbox an obvious affordance (cursor +
        // slight opacity) so users learn that toggling goes through Edit
        // markdown. Nested levels inherit the same treatment.
        '[&_li.task-list-item]:list-none',
        '[&_li.task-list-item]:pl-0',
        '[&_li.task-list-item>input[type=checkbox]]:mr-2',
        '[&_li.task-list-item>input[type=checkbox]]:cursor-not-allowed',
        '[&_li.task-list-item>input[type=checkbox]]:opacity-70',
        '[&_ul.contains-task-list]:list-none',
        '[&_ul.contains-task-list]:pl-4',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
