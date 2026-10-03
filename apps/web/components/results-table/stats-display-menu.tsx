'use client'

// The header dropdown of a stats column: one column whatever is displayed.
// It offers the single statistics the column carries and the display
// templates built from them; the choice is saved in the active View and
// also decides the statistic sorting, filters and SOTA compare (a separate
// "Sort by" choice can pin another statistic).

import { Sigma } from 'lucide-react'
import {
  columnTemplateOptions,
  DEFAULT_AGGREGATED_DISPLAY,
} from '../../lib/experiment-results/stats'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

const DEFAULT_VALUE = '__default__'
const FOLLOW_VALUE = '__follow__'

export function StatsDisplayMenu({
  label,
  statOptions,
  display,
  defaultDisplay,
  sortStat,
  disabled,
  onSelectDisplay,
  onSelectSort,
}: {
  label: string
  statOptions: readonly string[]
  /** The View's selection (null: the column default). */
  display: string | null
  /** The description file's default display, if any. */
  defaultDisplay: string | null
  /** The View's explicit sort statistic (null: follow the display). */
  sortStat: string | null
  disabled: boolean
  onSelectDisplay: (selection: string | null) => void
  onSelectSort: (stat: string | null) => void
}) {
  const templates = columnTemplateOptions(statOptions)
  const current = display ?? DEFAULT_VALUE
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn('shrink-0', display !== null && 'text-primary')}
          aria-label={`Display of ${label}: ${display ?? defaultDisplay ?? DEFAULT_AGGREGATED_DISPLAY}`}
          data-stats-display-trigger
          onClick={(event) => event.stopPropagation()}
        >
          <Sigma aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" data-slot="stats-display-menu">
        <DropdownMenuLabel className="truncate">Display · {label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => onSelectDisplay(value === DEFAULT_VALUE ? null : value)}
        >
          <DropdownMenuRadioItem value={DEFAULT_VALUE} disabled={disabled}>
            Default · {defaultDisplay ?? DEFAULT_AGGREGATED_DISPLAY}
          </DropdownMenuRadioItem>
          {statOptions.length > 0 && <DropdownMenuSeparator />}
          {statOptions.map((stat) => (
            <DropdownMenuRadioItem key={stat} value={stat} disabled={disabled}>
              <span className="font-mono">{stat}</span>
            </DropdownMenuRadioItem>
          ))}
          {templates.length > 0 && <DropdownMenuSeparator />}
          {templates.map((template) => (
            <DropdownMenuRadioItem key={template} value={template} disabled={disabled}>
              <span className="font-mono">{template}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {statOptions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={disabled}>
                Sort by · {sortStat ?? 'display'}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuRadioGroup
                  value={sortStat ?? FOLLOW_VALUE}
                  onValueChange={(value) => onSelectSort(value === FOLLOW_VALUE ? null : value)}
                >
                  <DropdownMenuRadioItem value={FOLLOW_VALUE} disabled={disabled}>
                    Follow the display
                  </DropdownMenuRadioItem>
                  {statOptions.map((stat) => (
                    <DropdownMenuRadioItem key={stat} value={stat} disabled={disabled}>
                      <span className="font-mono">{stat}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
