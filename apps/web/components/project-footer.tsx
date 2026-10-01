'use client'

// VSCode-style fixed bottom bar shown on every `/p/<project>/**` page.
// Bottom-left carries the current page's dependency freshness (see
// `<PageFreshness />`); bottom-right carries the existing Git/version
// affordances. The bar is `position: fixed` and on desktop indents from the
// left by `--sidebar-width` so it doesn't sit over the sidebar; on mobile the
// sidebar is off-canvas, so full-width is correct. Both halves stay reachable
// at phone width: the freshness text truncates and its secondary detail hides,
// while the Git pill and history control keep their own row space.

import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import Link from 'next/link'
import { type CSSProperties, useCallback, useState } from 'react'
import {
  fetchGitStatus,
  type ProjectTarget,
  projectHost,
  projectName,
  projectQueryKey,
  projectWebPath,
} from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { GitDiffDialog } from './git-diff-dialog'
import { GitHistoryDialog } from './git-history-dialog'
import { GitStatusPill } from './git-status-pill'
import { PageFreshness } from './page-freshness'
import { useWorkspaceSplitWidth } from './workspace-pane-provider'

export interface ProjectFooterProps {
  project: ProjectTarget
}

export function ProjectFooter({ project }: ProjectFooterProps) {
  const workspaceSplitWidth = useWorkspaceSplitWidth()
  // The two dialogs are mutually exclusive — opening one closes the other.
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)

  // Same query key as `<GitStatusPill />` so this read deduplicates with
  // the pill's poll — we don't fire an extra request.
  const { data } = useQuery({
    queryKey: queryKeys.gitStatus(project),
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
          'fixed bottom-0 left-0 right-[var(--workspace-split-width,0px)] z-40 flex h-7 items-center gap-2 border-t bg-card px-3 text-xs text-muted-foreground',
          'md:left-[var(--sidebar-width)]',
        )}
      >
        <PageFreshness project={projectName(project)} />
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <Link
            href={projectWebPath(project)}
            className="hidden truncate font-mono font-medium text-foreground hover:underline sm:inline"
          >
            {projectHost(project) ? `${projectHost(project)}/` : ''}
            {projectName(project)}
          </Link>
          {gitEnabled ? (
            <>
              <button
                type="button"
                onClick={openStatus}
                data-slot="git-diff-dialog-trigger"
                aria-label={`View git diff for ${projectName(project)}`}
                className="inline-flex cursor-pointer items-center rounded px-1 hover:bg-accent hover:text-accent-foreground"
              >
                <GitStatusPill project={project} variant="footer" />
              </button>
              {!projectHost(project) && (
                <button
                  type="button"
                  onClick={openHistory}
                  data-slot="git-history-dialog-trigger"
                  aria-label={`View git history for ${projectName(project)}`}
                  className="inline-flex cursor-pointer items-center rounded p-1 hover:bg-accent hover:text-accent-foreground"
                >
                  <History className="size-3.5" aria-hidden />
                </button>
              )}
            </>
          ) : (
            <GitStatusPill project={project} variant="footer" />
          )}
        </div>
      </footer>
      {gitEnabled && (
        <>
          <GitDiffDialog
            project={project}
            open={statusDialogOpen}
            onOpenChange={setStatusDialogOpen}
            onOpenHistory={projectHost(project) ? undefined : openHistory}
          />
          {!projectHost(project) && (
            <GitHistoryDialog
              project={projectName(project)}
              open={historyDialogOpen}
              onOpenChange={setHistoryDialogOpen}
            />
          )}
        </>
      )}
    </>
  )
}
