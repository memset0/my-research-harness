'use client'

// v4: archive toggle for runs and experiments. Inline button + tooltip.
//
// Hard rule (run side only): button is disabled when the run's current
// status is RUNNING — the user must transition out of RUNNING before
// archiving. The disabled tooltip explains why.
//
// Soft rule: archive of an already-archived target shows a noop result.
// Unarchive does NOT emit the soft warning per archive-frontmatter spec.

import { useQueryClient } from '@tanstack/react-query'
import { Archive as ArchiveIcon, ArchiveRestore } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  ApiError,
  type ProjectTarget,
  patchExperimentArchived,
  patchRunArchived,
  projectQueryKey,
} from '../lib/api'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

type Kind = 'run' | 'exp'

export function ArchiveToggle({
  kind,
  project,
  id,
  archived,
  runStatus,
  expectedMtime,
  className,
}: {
  kind: Kind
  project?: ProjectTarget
  id: string
  archived: boolean
  /** Run-side only: current status. Used to enforce the cannot-archive-RUNNING rule. */
  runStatus?: string
  expectedMtime?: number
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const projectKey = project ? projectQueryKey(project) : []

  // Hard rule: disable the archive action when targetting a run currently
  // RUNNING. Unarchive is always allowed.
  const archiveBlockedByStatus = kind === 'run' && !archived && runStatus === 'RUNNING'

  const target = !archived
  const label = archived ? 'Unarchive' : 'Archive'
  const Icon = archived ? ArchiveRestore : ArchiveIcon

  const onClick = async () => {
    if (archiveBlockedByStatus) return
    setBusy(true)
    try {
      const fn = kind === 'run' ? patchRunArchived : patchExperimentArchived
      const res = await fn({ ...(project ? { project } : {}), id, archived: target, expectedMtime })
      if ('error' in res && res.error?.code === 'CONFLICT') {
        toast.error('Archive conflicted (someone else just edited this)', {
          description: 'Reload to see the latest content, then try again.',
          action: {
            label: 'Reload',
            onClick: () =>
              queryClient.invalidateQueries({
                queryKey: [kind === 'run' ? 'run' : 'experiment', ...projectKey, id],
              }),
          },
        })
      } else if ('error' in res && res.error?.code === 'ARCHIVE_RUNNING_FORBIDDEN') {
        // Server-side double-check; UI should already disable the button.
        toast.error('Cannot archive a RUNNING run', {
          description: 'Set status to INTERRUPTED, FINISHED, or FAILED first.',
        })
      } else if ('archived' in res) {
        toast.success(target ? `Archived ${id}` : `Unarchived ${id}`)
        if (kind === 'run') {
          queryClient.invalidateQueries({ queryKey: ['run', ...projectKey, id] })
          queryClient.invalidateQueries({ queryKey: ['runs', ...projectKey] })
        } else {
          queryClient.invalidateQueries({
            queryKey: ['experiment', ...projectKey, id],
          })
          queryClient.invalidateQueries({ queryKey: ['experiments', ...projectKey] })
        }
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message
      toast.error(`Archive failed: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  const button = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy || archiveBlockedByStatus}
      onClick={() => void onClick()}
      className={className}
      aria-label={label}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </Button>
  )

  if (archiveBlockedByStatus) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{button}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return button
}
