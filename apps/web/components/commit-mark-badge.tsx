'use client'

// Small colored-dot badge indicating a commit's verification status.
// Reserves a fixed footprint so commit-list rows stay aligned even for
// unmarked commits (the dot is invisible in that case).

import type { CommitMark, CommitMarkStatus } from '../lib/api'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip'
import { cn } from '../lib/utils'

export interface CommitMarkBadgeProps {
  mark?: CommitMark | null
  size?: 'sm' | 'md'
  className?: string
}

const STATUS_COLOR: Record<CommitMarkStatus, string> = {
  verified: 'bg-emerald-500',
  suspicious: 'bg-amber-500',
  issue: 'bg-destructive',
}

const STATUS_LABEL: Record<CommitMarkStatus, string> = {
  verified: 'verified',
  suspicious: 'suspicious',
  issue: 'issue',
}

export function CommitMarkBadge({ mark, size = 'sm', className }: CommitMarkBadgeProps) {
  const status = mark?.status ?? null
  const dotSize = size === 'md' ? 'size-2.5' : 'size-2'

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-slot="commit-mark-badge"
            data-status={status ?? 'none'}
            className={cn(
              'inline-flex shrink-0 items-center justify-center',
              size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3',
              className,
            )}
          >
            <span
              className={cn(
                'rounded-full',
                dotSize,
                status ? STATUS_COLOR[status] : 'bg-transparent opacity-0',
              )}
              aria-hidden
            />
          </span>
        </TooltipTrigger>
        {mark && (
          <TooltipContent side="right" align="start">
            <div className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5 font-mono text-xs">
              <span>commit mark</span>
              <span className="font-medium">(deprecated)</span>
              <span>status</span>
              <span className="font-medium">{STATUS_LABEL[mark.status]}</span>
              {mark.note && (
                <>
                  <span>note</span>
                  <span className="whitespace-pre-wrap">{mark.note}</span>
                </>
              )}
              <span>updated</span>
              <span>{mark.updatedAt}</span>
            </div>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  )
}
