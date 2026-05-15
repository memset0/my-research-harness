'use client'

// VSCode-style fixed bottom bar shown on every `/p/<project>/**` page.
// Initially just hosts the per-project git pill, with reserved right-side
// space for future widgets. The bar is `position: fixed` and on desktop
// indents from the left by `--sidebar-width` so it doesn't sit over the
// sidebar; on mobile the sidebar is off-canvas, so full-width is correct.

import Link from 'next/link'
import { cn } from '../lib/utils'
import { GitStatusPill } from './git-status-pill'

export interface ProjectFooterProps {
  project: string
}

export function ProjectFooter({ project }: ProjectFooterProps) {
  return (
    <footer
      data-slot="project-footer"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex h-7 items-center gap-3 border-t bg-card px-3 text-xs text-muted-foreground',
        'md:left-[var(--sidebar-width)]',
      )}
    >
      <Link
        href={`/p/${encodeURIComponent(project)}`}
        className="font-mono font-medium text-foreground hover:underline"
      >
        {project}
      </Link>
      <span className="text-muted-foreground/40">·</span>
      <GitStatusPill project={project} variant="footer" />
      {/* Spacer reserved for future widgets (build state, monitor, etc.). */}
      <div className="ml-auto" />
    </footer>
  )
}
