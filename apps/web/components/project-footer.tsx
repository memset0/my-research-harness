'use client'

// VSCode-style fixed bottom bar shown on every `/p/<project>/**` page.
// Initially just hosts the per-project git pill, with reserved right-side
// space for future widgets. The bar is `position: fixed` and on desktop
// indents from the left by `--sidebar-width` so it doesn't sit over the
// sidebar; on mobile the sidebar is off-canvas, so full-width is correct.

import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import Link from 'next/link'
import { type CSSProperties, useCallback, useState } from 'react'
import { fetchGitStatus } from '../lib/api'
import { cn } from '../lib/utils'
import { GitDiffDialog } from './git-diff-dialog'
import { GitHistoryDialog } from './git-history-dialog'
import { GitStatusPill } from './git-status-pill'
import { useWorkspaceSplitWidth } from './terminal-drawer-provider'

export interface ProjectFooterProps {
  project: string
}

export function ProjectFooter({ project }: ProjectFooterProps) {
  const workspaceSplitWidth = useWorkspaceSplitWidth()
  // The two dialogs are mutually exclusive — opening one closes the other.
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)

  // Same query key as `<GitStatusPill />` so this read deduplicates with
  // the pill's poll — we don't fire an extra request.
  const { data } = useQuery({
    queryKey: ['git-status', project],
    queryFn: () => fetchGitStatus(project),
    staleTime: 5_000,
    retry: false,
  })
  const gitEnabled = data?.enabled === true

  const openStatus = useCallback(() => {
    setHistoryDialogOpen(false)
    setStatusDialogOpen(true)
  }, [])
  const openHistory = useCallback(() => {
    setStatusDialogOpen(false)
    setHistoryDialogOpen(true)
  }, [])

  return (
    <>
      <footer
        data-slot="project-footer"
        style={
          {
            '--workspace-split-width': `${workspaceSplitWidth}px`,
          } as CSSProperties
        }
        className={cn(
          'fixed bottom-0 left-0 right-[var(--workspace-split-width,0px)] z-40 flex h-7 items-center gap-3 border-t bg-card px-3 text-xs text-muted-foreground',
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
        {gitEnabled ? (
          <>
            <button
              type="button"
              onClick={openStatus}
              data-slot="git-diff-dialog-trigger"
              aria-label={`View git diff for ${project}`}
              className="inline-flex cursor-pointer items-center rounded px-1 hover:bg-accent hover:text-accent-foreground"
            >
              <GitStatusPill project={project} variant="footer" />
            </button>
            <button
              type="button"
              onClick={openHistory}
              data-slot="git-history-dialog-trigger"
              aria-label={`View git history for ${project}`}
              className="inline-flex cursor-pointer items-center rounded p-1 hover:bg-accent hover:text-accent-foreground"
            >
              <History className="size-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <GitStatusPill project={project} variant="footer" />
        )}
        {/* Spacer reserved for future widgets (build state, monitor, etc.). */}
        <div className="ml-auto" />
      </footer>
      {gitEnabled && (
        <>
          <GitDiffDialog
            project={project}
            open={statusDialogOpen}
            onOpenChange={setStatusDialogOpen}
            onOpenHistory={openHistory}
          />
          <GitHistoryDialog
            project={project}
            open={historyDialogOpen}
            onOpenChange={setHistoryDialogOpen}
          />
        </>
      )}
    </>
  )
}
