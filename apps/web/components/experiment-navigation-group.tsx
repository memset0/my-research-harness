'use client'

import {
  Archive,
  ChevronRight,
  CircleDot,
  CircleHelp,
  CircleSlash,
  PauseCircle,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { ExperimentGroup } from '../lib/experiment-navigation'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

export function ExperimentNavigationGroup({
  group,
  count,
  forceOpen = false,
  compact = false,
  children,
}: {
  group: ExperimentGroup
  count: number
  forceOpen?: boolean
  compact?: boolean
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(!group.collapsed)
  const open = forceOpen || expanded
  const Icon =
    group.key === 'PAUSED'
      ? PauseCircle
      : group.key === 'RETIRED' || group.key === 'ABANDONED'
        ? CircleSlash
        : group.key === 'ARCHIVED' || group.key === 'LEGACY_ARCHIVED'
          ? Archive
          : group.key === 'UNKNOWN'
            ? CircleHelp
            : CircleDot
  return (
    <Collapsible
      open={open}
      onOpenChange={setExpanded}
      data-experiment-group={group.key}
      className={compact ? 'py-1' : 'space-y-2'}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          aria-label={`${group.label} experiments (${count})`}
          className={cn(
            'h-auto w-full justify-start gap-2 text-left',
            compact ? 'px-2 py-1.5 text-xs' : 'px-1 py-2',
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          />
          <Icon
            aria-hidden
            className={cn(
              'size-4 shrink-0',
              group.key === 'ACTIVE' && 'text-sky-700 dark:text-sky-300',
              group.key === 'PAUSED' && 'text-amber-700 dark:text-amber-300',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{group.label}</span>
            {!compact && (
              <span className="ml-3 hidden text-xs font-normal text-muted-foreground sm:inline">
                {group.description}
              </span>
            )}
          </span>
          <span className="rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
