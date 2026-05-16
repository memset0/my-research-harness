'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Plus, Terminal } from 'lucide-react'
import {
  checkTerminal,
  fetchExperimentDocs,
  fetchGitStatus,
  fetchProjects,
  type ExperimentDocSummary,
} from '../lib/api'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import { useSession } from './session-provider'
import { SidebarResizeHandle } from './sidebar-resize-handle'
import { SlurmStatusWidget } from './slurm-status-widget'
import { GitDiffDialog } from './git-diff-dialog'
import { GitStatusPill } from './git-status-pill'
import { TerminalSheet } from './terminal-sheet'
import { ThemeToggle } from './theme-toggle'

const STORAGE_KEY = 'memon:sidebar:expanded'

export function AppSidebar() {
  const { role, scopeProjects } = useSession()
  // Which project's git-status dialog (if any) is open, opened from one
  // of the sidebar's compact git pills. `null` = closed.
  const [diffDialogProject, setDiffDialogProject] = useState<string | null>(null)
  const pathname = usePathname() ?? ''
  const activeProject = decodeURIComponent(pathname.match(/^\/p\/([^/]+)/)?.[1] ?? '')
  // v3 exp-doc detail URLs: `/p/<project>/e/<E-id>` (and the alias
  // `/p/<project>/r/<run-id>` already redirects to the same exp page).
  const activeExpDocId = decodeURIComponent(
    pathname.match(/\/e\/([^/]+)/)?.[1] ?? '',
  )

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 60_000,
  })
  const allProjects = projectsData?.projects ?? []
  // Viewer sessions: restrict to scope-set projects. Owner / anon: full list.
  const projects =
    role === 'viewer'
      ? allProjects.filter((p) => scopeProjects.includes(p.name))
      : allProjects

  // Default: the active project is open. This means the very first SSR HTML
  // already contains its experiment rows (no skeleton flash on initial nav).
  // Hydration matches because both server and client compute the same default.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeProject ? [activeProject] : []),
  )
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const stored = raw ? new Set(JSON.parse(raw) as string[]) : new Set<string>()
      // Always show the active project even if localStorage previously closed it
      if (activeProject) stored.add(activeProject)
      setExpanded(stored)
    } catch {
      /* ignore */
    }
    setHydrated(true)
  }, [activeProject])

  useEffect(() => {
    if (!hydrated) return
    try {
      const validNames = new Set(projects.map((p) => p.name))
      const pruned = Array.from(expanded).filter((n) => validNames.has(n))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned))
    } catch {
      /* ignore */
    }
  }, [expanded, projects, hydrated])

  const onToggle = (name: string, open: boolean) => {
    setExpanded((cur) => {
      const next = new Set(cur)
      if (open) next.add(name)
      else next.delete(name)
      return next
    })
  }

  return (
    <Sidebar>
      <SidebarHeader className="flex flex-row items-center justify-between px-3 py-2">
        <Link
          href="/"
          className="font-mono text-lg font-bold tracking-tight text-sidebar-foreground"
        >
          memon
        </Link>
        <ThemeToggle />
      </SidebarHeader>
      {/*
        VSCode-Explorer-style section layout via CSS Grid.

        We replace shadcn SidebarContent's default flex layout with a
        grid for two reasons:

        1. **Banner safety**: in a flex column where each section is a
           flex child with default `flex-shrink: 1`, multi-expand
           overflow shrinks EVERY child including closed sections —
           collapsing their banners below intrinsic height, causing
           visible banner overlap. Grid rows with `minmax(BANNER, ...)`
           enforce a hard minimum per row, so banners never compress.

        2. **Smooth multi-section animation**: animating each row from
           `minmax(BANNER, 0fr)` to `minmax(BANNER, 1fr)` interpolates
           the `fr` component natively (Chrome 121+ supports fr-unit
           interpolation in minmax). All rows reflow simultaneously
           — the opened section grows, expanded siblings shrink to
           share — over a single 200ms `grid-template-rows`
           transition. Earlier attempts with flex-grow / per-row
           Radix keyframes either fought the flex overflow or
           snap-jumped because of mismatched basis values.

        `gridTemplateRows` is computed from the `expanded` set;
        `!grid` overrides shadcn's `flex` (Tailwind's `!` = important).
        `overflow-hidden` clips section content during transition so
        intermediate intrinsic-vs-row-size mismatches don't bleed
        into siblings.
      */}
      <SidebarContent
        style={{
          gridTemplateRows: projects
            .map((p) =>
              expanded.has(p.name)
                ? `minmax(var(--sidebar-section-banner-h, 1.75rem), 1fr)`
                : `minmax(var(--sidebar-section-banner-h, 1.75rem), 0fr)`,
            )
            .join(' '),
        }}
        className="!grid !overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
      >
        {projects.map((p) => (
          <ProjectGroup
            key={p.name}
            name={p.name}
            isActive={p.name === activeProject}
            isOpen={expanded.has(p.name)}
            activeExpDocId={activeExpDocId}
            onOpenChange={(open) => onToggle(p.name, open)}
            onPillClick={() => setDiffDialogProject(p.name)}
          />
        ))}
        {projects.length === 0 && (
          <SidebarGroup>
            <SidebarGroupContent className="px-3 py-2 text-xs text-sidebar-foreground/60">
              No projects configured
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          {role !== 'viewer' && (
            <>
              <SlurmStatusWidget />
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="sm" isActive={pathname === '/manage/tmux'}>
                  <Link href="/manage/tmux">
                    <Terminal className="size-4" />
                    <span>Manage tmux</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </>
          )}
        </SidebarMenu>
      </SidebarFooter>
      {/*
        Desktop drag-to-resize handle. Absolute-positioned overlay aligned
        to the sidebar column's right edge. Hidden on `<md` and when the
        sidebar is collapsed; commits new widths to localStorage so the
        choice survives reloads. See `components/sidebar-resize-handle.tsx`
        for the full interaction contract (pointer drag + keyboard arrow
        steps).
      */}
      <SidebarResizeHandle />
      {diffDialogProject && (
        <GitDiffDialog
          project={diffDialogProject}
          open
          onOpenChange={(open) => {
            if (!open) setDiffDialogProject(null)
          }}
        />
      )}
    </Sidebar>
  )
}

/** One collapsible project group, rendered as a VSCode-Explorer-style
 *  section: a banner header (smaller uppercase name + top/bottom divider
 *  + tinted background) that visually separates each project from the
 *  next, and a scrollable body of experiment rows below. Clicking the
 *  header toggles expand/collapse — no chevron indicator; the banner
 *  contrast IS the affordance.
 *
 *  Header row layout (left-to-right): uppercase project-name span (yields
 *  width first via `min-w-0 flex-1 truncate`), then the right-aligned
 *  compact GitStatusPill (`shrink-0`, never truncated — long branch
 *  names push the project title to ellipsis instead).
 *
 *  When expanded, the group fills its share of `SidebarContent`'s height
 *  via `flex-1 min-h-0`; the inner experiment list scrolls inside the
 *  section bounds. When collapsed, only the header row consumes height
 *  (`flex-none`).
 *
 *  Renders exactly one sub-section per expanded project — the v3
 *  experiments list, sorted by `effectiveUpdatedAt` desc. Runs are
 *  reachable through their parent experiment, not via the sidebar. */
function ProjectGroup({
  name,
  isActive,
  isOpen,
  activeExpDocId,
  onOpenChange,
  onPillClick,
}: {
  name: string
  isActive: boolean
  isOpen: boolean
  activeExpDocId: string
  onOpenChange: (open: boolean) => void
  onPillClick: () => void
}) {
  // Same query key as the pill — TanStack dedupes. We use the result to
  // know whether to render the clickable wrapper at all. For non-git
  // projects (`enabled: false` or query pending) the pill returns null
  // and we skip the click target so nothing reactable sits in the row.
  const { data: gitStatus } = useQuery({
    queryKey: ['git-status', name],
    queryFn: () => fetchGitStatus(name),
    staleTime: 5_000,
    retry: false,
  })
  const gitEnabled = gitStatus?.enabled === true
  return (
    // IMPORTANT: the flex-1/flex-none toggle lives on the <Collapsible>
    // wrapper, NOT on the inner <SidebarGroup>. Radix Collapsible
    // renders an extra `<div>` between SidebarContent and SidebarGroup,
    // so SidebarContent's flex algorithm sees THIS element as its
    // direct child. If flex-1 were on SidebarGroup instead, the
    // Collapsible div between them would still take its content height
    // (since it has no flex class), every section would render at
    // intrinsic content height, and SidebarContent's default
    // `overflow-auto` would kick in — the user observes "outer scrollbar
    // instead of per-section internal scroll". Putting flex-1 here
    // makes the section row actually a flex child of SidebarContent and
    // restores the multi-expand even-height contract.
    // Each Collapsible is now a single GRID ROW of SidebarContent's
    // grid (see the SidebarContent block above for the row-template).
    // We deliberately do NOT carry flex-grow / flex-1 / flex-none on
    // this wrapper anymore — the outer grid's `minmax(28px, 0fr|1fr)`
    // template controls the row's height transition. The wrapper just
    // needs to be a flex column internally (banner + content stack)
    // and clip overflow so content shrinking past banner-only height
    // disappears cleanly during the grid transition.
    //
    // `min-h-0` is essential so the inner `<CollapsibleContent>` with
    // `flex-1 min-h-0 overflow-y-auto` can shrink past min-content and
    // scroll internally instead of pushing the row taller than its
    // grid-template-rows says.
    <Collapsible
      open={isOpen}
      onOpenChange={onOpenChange}
      className="group/collapsible flex min-h-0 flex-col overflow-hidden"
    >
      <SidebarGroup
        className={cn(
          'gap-0 py-0',
          // SidebarGroup now ALWAYS uses the flex chain so its inner
          // CollapsibleContent (`flex-1 min-h-0`) can resolve against
          // a known parent height. The flex-1/flex-none decision is
          // entirely up at the <Collapsible> level above.
          'flex min-h-0 flex-1 flex-col',
        )}
      >
        <SidebarGroupLabel
          asChild
          className={cn(
            // Banner styling: edge-to-edge tinted background bracketed
            // by top/bottom dividers. This is what carries the
            // "different project" signal — no chevron needed.
            //
            // `-mx-2` offsets the parent SidebarGroup's `px-2` so the
            // banner extends to the sidebar's left/right edges; the
            // label keeps its own `px-2` so text isn't flush against
            // those edges. `rounded-none` overrides shadcn's default
            // `rounded-md` since rounded corners on an edge-to-edge
            // banner look out of place.
            //
            // `bg-sidebar-accent/60` is the deeper base (was /40 in the
            // first cut — owner asked for more contrast); hover steps
            // up to full `bg-sidebar-accent` so the affordance still
            // reads as reactive even with a darker resting state.
            //
            // `text-left` overrides the native <button> default of
            // `text-align: center` that CollapsibleTrigger renders
            // with — without it the project name floats to the middle
            // of the flex-1 span instead of sitting flush-left.
            // Banner height is fixed to `h-7` (1.75rem = 28px) so the
            // grid-row `minmax(1.75rem, …)` min matches the banner
            // exactly — closed rows are 28px = banner with no slack
            // and no overflow.
            'h-7 cursor-pointer rounded-none border-y border-sidebar-border bg-sidebar-accent/60 px-2 -mx-2 text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            isActive && 'text-sidebar-primary',
          )}
        >
          <CollapsibleTrigger>
            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider">
              {name}
            </span>
            {gitEnabled ? (
              // The pill is INSIDE the CollapsibleTrigger button, so a
              // bare click bubbles up and toggles the section. Wrap the
              // pill in a span that captures pointer + click + keyboard
              // events with stopPropagation so clicks on the pill open
              // the git-diff dialog INSTEAD of toggling the section.
              // `role="button" + tabIndex` keeps it keyboard-reachable
              // without nesting an actual <button> in another <button>
              // (invalid HTML).
              <span
                data-slot="git-status-pill-trigger"
                role="button"
                tabIndex={0}
                aria-label={`View git diff for ${name}`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onPillClick()
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    onPillClick()
                  }
                }}
                className="shrink-0 cursor-pointer rounded px-1 hover:bg-accent hover:text-accent-foreground"
              >
                <GitStatusPill
                  project={name}
                  variant="compact"
                  className="shrink-0"
                />
              </span>
            ) : (
              <GitStatusPill
                project={name}
                variant="compact"
                className="shrink-0"
              />
            )}
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        {/*
          With the grid-template-rows transition on the OUTER
          SidebarContent driving the section's height animation, we
          drop Radix's `animate-collapsible-*` keyframes here — they
          would compete with the row's height (keyframe sets
          `height: 0 → var(--radix-collapsible-content-height)`
          which doesn't match the row-share size) and produce a
          snap when the keyframe ends.

          `forceMount` keeps the content in the DOM regardless of
          state. Combined with Radix's internal `hidden: !isOpen`,
          this means the element exists but `display: none`s when
          closed — so closed rows' grid-row intrinsic stays at
          banner-only height. When opening, Radix removes hidden
          and the row's `1fr` grid max kicks in, letting the
          grid-template-rows transition smoothly grow the row.

          `flex-1 min-h-0 overflow-hidden` makes CollapsibleContent
          fill the row's remaining space after the banner; the
          inner scroll div with `overflow-y-auto` handles content
          taller than the available space.
        */}
        <CollapsibleContent
          forceMount
          className="flex-1 min-h-0 overflow-hidden"
        >
          <div className="h-full overflow-y-auto">
            <SidebarGroupContent>
              <ProjectExperimentDocs project={name} activeId={activeExpDocId} enabled={isOpen} />
            </SidebarGroupContent>
          </div>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

/** v3 experiment-doc list, one entry per
 *  `<projectRoot>/docs/experiments/E*-<slug>/README.md`. The only sub-section
 *  rendered under each project group. Sorted by `effectiveUpdatedAt`
 *  descending so the most recently active experiment is at the top —
 *  matching the default sort on `experiment-card-grid.tsx`.
 *
 *  All active (non-archived) experiments are rendered unconditionally;
 *  long lists scroll inside the parent section (see `ProjectGroup`'s
 *  `<CollapsibleContent>` `overflow-y-auto`). No 5-item cap, no "View
 *  more" affordance — those were removed in favor of internal scroll. */
function ProjectExperimentDocs({
  project,
  activeId,
  enabled,
}: {
  project: string
  activeId: string
  enabled: boolean
}) {
  // `enabled` mirrors the parent section's open state. When the
  // project section is collapsed we ALSO want the query to stop
  // polling (the global QueryClient `refetchInterval: 60_000` would
  // otherwise tick on every cached query). TanStack Query v5 only
  // runs `refetchInterval` for queries in the "active" state, and a
  // disabled query is not active — so `enabled: false` transitively
  // disables the interval. SSE-driven invalidation
  // (`['experiments', project]` via `MemonEventsBridge`) also
  // refetches only mounted+enabled queries, so collapsed sections
  // remain bandwidth-free until the user re-expands them.
  const { data, isLoading } = useQuery({
    queryKey: ['experiments', project],
    queryFn: () => fetchExperimentDocs(project),
    enabled,
    staleTime: 5_000,
  })
  const docs: ExperimentDocSummary[] = data?.experiments ?? []
  // v4: sidebar shows ACTIVE experiments only. Archived items are not
  // surfaced here at all — they live exclusively on the main grid (which
  // has the "Show archived" checkbox + bottom-of-list bucket).
  const sorted = useMemo(
    () =>
      docs
        .filter((e) => !e.frontMatter.archived)
        .slice()
        .sort((a, b) => b.effectiveUpdatedAt.localeCompare(a.effectiveUpdatedAt)),
    [docs],
  )
  // First-fetch state: section just expanded, no cached data yet.
  // Show a spinner so the user knows the section is loading (rather
  // than mistaking the empty body for "no experiments"). TanStack
  // Query's cache handles the "previous data while refetching" case
  // automatically — `data` returns the stale array, so `docs.length
  // > 0` and we skip this branch.
  if (enabled && isLoading && docs.length === 0) {
    return (
      <div
        data-slot="exp-list-loading"
        className="flex items-center justify-center py-3 text-sidebar-foreground/50"
      >
        <Loader2 className="size-4 animate-spin" aria-label="Loading experiments" />
      </div>
    )
  }
  if (!enabled) return null
  if (docs.length === 0 && !isLoading) {
    return null
  }
  return (
    <SidebarMenu>
      {sorted.map((exp) => {
        const isActive = exp.id === activeId
        return (
          <SidebarMenuItem key={exp.id} className="flex w-full items-center">
            {/*
              Active-state wrapper. Carries the highlight background for
              the currently-open experiment and stretches across BOTH the
              link button and the trailing per-row "+" terminal button so
              the highlight covers everything to the right edge of the
              row. The inner SidebarMenuButton's own bg classes are
              suppressed (hover:bg-transparent /
              data-[active=true]:bg-transparent) so this wrapper is the
              single source of background truth.

              No separate left-side indent gutter — the leading run-count
              badge (rendered as the first child of the link below) IS
              the row's left-side visual; it doubles as a numeric badge
              AND as the per-row indentation cue.
            */}
            <div
              className={cn(
                'flex min-w-0 flex-1 items-center rounded-md transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'hover:bg-sidebar-accent/40',
              )}
            >
              <SidebarMenuButton
                asChild
                isActive={isActive}
                size="sm"
                className="min-w-0 flex-1 hover:bg-transparent data-[active=true]:bg-transparent"
              >
                <Link
                  href={`/p/${encodeURIComponent(project)}/e/${encodeURIComponent(exp.id)}`}
                  title={exp.frontMatter.title}
                >
                  {/*
                    Leading run-count badge: a small circle showing how
                    many runs are bound to this experiment. Always
                    rendered (even when count is 0) so every row's
                    leading edge sits at the same column — the badge
                    plays the role the indent gutter used to play.
                    `bg-sidebar-foreground/10 text-sidebar-foreground/70`
                    stays legible against both the resting and the
                    `bg-sidebar-accent` active backgrounds.
                  */}
                  <span
                    aria-label={`${exp.frontMatter.runs.length} runs`}
                    className="flex size-[1.125rem] shrink-0 items-center justify-center rounded-full bg-sidebar-foreground/5 text-[9px] tabular-nums text-sidebar-foreground/60"
                  >
                    {exp.frontMatter.runs.length}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{exp.id}</span>
                </Link>
              </SidebarMenuButton>
              {/*
                Per-row plain-shell terminal launcher. Sibling of the
                <Link>-wrapped <SidebarMenuButton> so a click on the icon
                does not also navigate. Renders as a "+" (new terminal)
                to read as "create something new" rather than "this row
                is a terminal". Owner-only (hidden for viewers via session
                check inside the component), ttyd-gated, and opens a
                right-side TerminalSheet drawer with agent: 'none'.
              */}
              <ExpRowTerminalButton project={project} expId={exp.id} />
            </div>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

/** Per-experiment-row "new terminal" launcher (plain shell, owner-only).
 *
 *  Renders as a Plus icon — semantically "create a new terminal" rather
 *  than "this row is itself a terminal". Always-visible icon-only button
 *  that opens a right-side `<TerminalSheet>` drawer with `agent: 'none'`
 *  for a plain bash session scoped to the experiment's folder. Reuses
 *  the existing `['terminal','check']` probe (same key as `TerminalButton`)
 *  so the cache hit is free when the page already renders an experiment-
 *  detail terminal button.
 *
 *  Three states:
 *  - Viewer session → renders null (hidden).
 *  - Owner + probe pending → renders nothing (avoid first-paint flicker).
 *  - Owner + probe.available === true → enabled button opens the sheet.
 *  - Owner + probe.available === false → disabled button with tooltip
 *    surfacing `probe.suggestion ?? 'ttyd unavailable'`.
 *
 *  Click handler calls `e.stopPropagation()` so the surrounding row's
 *  link does not also navigate when the icon is clicked. */
function ExpRowTerminalButton({ project, expId }: { project: string; expId: string }) {
  const { role } = useSession()
  const [sheetOpen, setSheetOpen] = useState(false)

  // Probe only when the user is the owner — viewers can't use the shell
  // API and the probe itself is owner-only (it would 401 + trigger the
  // native Basic-auth dialog otherwise).
  const { data: probe } = useQuery({
    queryKey: ['terminal', 'check'],
    queryFn: checkTerminal,
    staleTime: 10_000,
    enabled: role === 'owner',
  })

  if (role === 'viewer') return null
  if (!probe) return null

  const onIconClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Defence in depth: the icon button is a sibling of the <Link>, not
    // nested inside it, but tooltip wrappers occasionally bubble events
    // in unexpected ways across browsers — stop propagation explicitly.
    e.stopPropagation()
    e.preventDefault()
    setSheetOpen(true)
  }

  // State A — ttyd available
  if (probe.available) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          aria-label={`New terminal for ${expId}`}
          onClick={onIconClick}
        >
          <Plus className="size-3.5" />
        </Button>
        <TerminalSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          project={project}
          scope="exp"
          slug={expId}
          agent="none"
        />
      </>
    )
  }

  // State B / C — ttyd unavailable (downloadable or manual). Render a
  // disabled button with a tooltip surfacing the suggestion. The install
  // affordance for `downloadable` lives on the existing TerminalButton
  // (experiment-detail page); the sidebar icon stays passive here.
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label={`New terminal for ${expId} (ttyd unavailable)`}
              disabled
            >
              <Plus className="size-3.5" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className="font-mono text-[11px]">
            {probe.suggestion ?? 'ttyd unavailable'}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
