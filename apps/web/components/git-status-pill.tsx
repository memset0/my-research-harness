'use client'

// Per-project git working-tree status pill, rendered in two places:
// - sidebar (variant="compact"): branch + dirty dot, tooltip with details
// - project footer (variant="footer"): branch + ahead/behind + count chips
//
// Both variants share the TanStack query key `['git-status', project]` so
// the sidebar pill and the footer pill on the same project make ONE
// request per 5s, not two.

import { GitBranch } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchGitStatus, type GitStatus } from '../lib/api'
import { useRuntimeConfig } from '../lib/runtime-config'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip'
import { cn } from '../lib/utils'

const BRANCH_TRUNCATE = 18

type EnabledStatus = Extract<GitStatus, { enabled: true }>

export interface GitStatusPillProps {
  project: string
  variant: 'compact' | 'footer'
  className?: string
}

export function GitStatusPill({ project, variant, className }: GitStatusPillProps) {
  const { gitStatus } = useRuntimeConfig()
  const intervalMs = gitStatus.intervalMs
  const { data, isPending, isError } = useQuery({
    queryKey: ['git-status', project],
    queryFn: () => fetchGitStatus(project),
    refetchInterval: intervalMs,
    staleTime: Math.max(0, Math.floor(intervalMs / 2)),
    retry: false,
  })

  if (isPending || isError || !data || data.enabled === false) {
    return null
  }

  return variant === 'compact' ? (
    <CompactPill status={data} className={className} />
  ) : (
    <FooterPill status={data} className={className} />
  )
}

function CompactPill({ status, className }: { status: EnabledStatus; className?: string }) {
  const label = status.detached
    ? `(${status.sha})`
    : truncateBranch(status.branch ?? '?')
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-slot="git-status-pill-compact"
            className={cn(
              'inline-flex items-center gap-1 text-[10px] text-muted-foreground',
              status.detached && 'italic',
              className,
            )}
          >
            <GitBranch className="size-3 shrink-0" aria-hidden />
            <span className="truncate font-mono">{label}</span>
            {status.dirty ? (
              <span
                aria-label="dirty working tree"
                className="size-1.5 shrink-0 rounded-full bg-primary"
              />
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" align="start">
          <GitStatusTooltipBody status={status} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function FooterPill({ status, className }: { status: EnabledStatus; className?: string }) {
  const label = status.detached
    ? `(${status.sha})`
    : status.branch ?? '?'
  const showAhead = status.ahead > 0
  const showBehind = status.behind > 0
  const showStaged = status.staged > 0
  const showUnstaged = status.unstaged > 0
  const showUntracked = status.untracked > 0
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-slot="git-status-pill-footer"
            className={cn(
              'inline-flex items-center gap-2 font-mono text-xs text-muted-foreground',
              status.detached && 'italic',
              className,
            )}
          >
            <span className="inline-flex items-center gap-1">
              <GitBranch className="size-3.5 shrink-0" aria-hidden />
              <span>{label}</span>
            </span>
            {(showAhead || showBehind) && (
              <span className="inline-flex items-center gap-1">
                {showAhead && <span aria-label={`${status.ahead} ahead`}>↑{status.ahead}</span>}
                {showBehind && <span aria-label={`${status.behind} behind`}>↓{status.behind}</span>}
              </span>
            )}
            {(showStaged || showUnstaged || showUntracked) && (
              <span className="inline-flex items-center gap-1">
                {showStaged && (
                  <span aria-label={`${status.staged} staged`} className="text-primary">
                    ●{status.staged}
                  </span>
                )}
                {showUnstaged && (
                  <span aria-label={`${status.unstaged} unstaged`}>
                    ○{status.unstaged}
                  </span>
                )}
                {showUntracked && (
                  <span aria-label={`${status.untracked} untracked`}>
                    ?{status.untracked}
                  </span>
                )}
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          <GitStatusTooltipBody status={status} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function GitStatusTooltipBody({ status }: { status: EnabledStatus }) {
  const ref = status.detached
    ? `detached @ ${status.sha}`
    : status.branch ?? '(unknown)'
  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5 font-mono">
      <span>ref</span>
      <span>{ref}</span>
      {status.upstream && (
        <>
          <span>upstream</span>
          <span>{status.upstream}</span>
        </>
      )}
      {(status.ahead > 0 || status.behind > 0) && (
        <>
          <span>ab</span>
          <span>
            ↑{status.ahead} ↓{status.behind}
          </span>
        </>
      )}
      <span>staged</span>
      <span>{status.staged}</span>
      <span>unstaged</span>
      <span>{status.unstaged}</span>
      <span>untracked</span>
      <span>{status.untracked}</span>
    </div>
  )
}

function truncateBranch(name: string): string {
  if (name.length <= BRANCH_TRUNCATE) return name
  return name.slice(0, BRANCH_TRUNCATE - 1) + '…'
}
