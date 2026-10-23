'use client'

import { useQuery } from '@tanstack/react-query'
import { Gauge, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  type ExperimentListRow,
  fetchExperimentDocs,
  fetchExperimentsInventory,
  fetchGitStatus,
  fetchHosts,
  fetchProjects,
  type ProjectSummary,
  type ProjectTarget,
  projectHost,
  projectName,
} from '../lib/api'
import {
  compareExperimentNavigation,
  EXPERIMENT_GROUPS,
  experimentGroup,
  shortExperimentId,
} from '../lib/experiment-navigation'
import {
  artifactNumber,
  parseProjectPath,
  projectBasePath,
  projectOfPath,
} from '../lib/project-routes'
import { queryKeys } from '../lib/query-keys'
import { cn } from '../lib/utils'
import { ExperimentNavigationGroup } from './experiment-navigation-group'
import { GitDiffDialog } from './git-diff-dialog'
import { GitStatusPill } from './git-status-pill'
import { HostStatusBadge } from './host-status-badge'
import { useSession } from './session-provider'
import { SidebarResizeHandle } from './sidebar-resize-handle'
import { SlurmStatusWidget } from './slurm-status-widget'
import { ExperimentStatusPill } from './status-pill'
import { ThemeToggle } from './theme-toggle'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
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

const STORAGE_KEY = 'memon:sidebar:expanded'

export function projectSummaryTarget(project: ProjectSummary): ProjectTarget {
  return project.mode === 'central'
    ? ({ host: project.host, project: project.project } as ProjectTarget)
    : project.project
}

export function sidebarProjectIdentity(target: ProjectTarget): string {
  const host = projectHost(target)
  return host
    ? `h:${encodeURIComponent(host)}/p:${encodeURIComponent(projectName(target))}`
    : projectName(target)
}

/**
 * `/<host>/<project>`. A hostless Project has no page route (the Web entry
 * refuses such configs); its links stay same-origin paths, never a
 * protocol-relative `//…` URL.
 */
export function sidebarProjectBasePath(target: ProjectTarget): string {
  return typeof target === 'string' ? '' : projectBasePath(target)
}

function activeProjectTarget(pathname: string): ProjectTarget | null {
  return (projectOfPath(pathname) as ProjectTarget | null) ?? null
}

function isActiveRow(id: string, activeNumber: number | null): boolean {
  return activeNumber !== null && artifactNumber(id) === activeNumber
}

/** The Experiment number of an Experiment detail page `/<host>/<project>/e/<n>`. */
function activeExperimentNumber(pathname: string): number | null {
  const page = parseProjectPath(pathname)?.page
  return page?.kind === 'experiment' ? page.number : null
}

export function AppSidebar() {
  const { role, scopeProjects, scopeProjectRefs } = useSession()
  // Which project's git-status dialog (if any) is open, opened from one
  // of the sidebar's compact git pills. `null` = closed.
  const [diffDialogProject, setDiffDialogProject] = useState<ProjectTarget | null>(null)
  const pathname = usePathname() ?? ''
  const activeTarget = activeProjectTarget(pathname)
  const activeProjectKey = activeTarget ? sidebarProjectIdentity(activeTarget) : ''
  const activeNumber = activeExperimentNumber(pathname)

  const { data: projectsData } = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: fetchProjects,
    staleTime: 60_000,
  })
  const { data: hostsData } = useQuery({
    queryKey: queryKeys.hosts(),
    queryFn: fetchHosts,
    staleTime: 10_000,
    retry: false,
  })
  const allProjects = projectsData?.projects ?? []
  const centralMode =
    hostsData !== undefined || allProjects.some((project) => project.mode === 'central')
  const standaloneProjects = allProjects.filter(
    (project) =>
      project.mode === 'standalone' &&
      (role !== 'viewer' || scopeProjects.includes(project.project)),
  )
  const centralProjects =
    role === 'owner'
      ? allProjects.filter((project) => project.mode === 'central')
      : role === 'viewer'
        ? allProjects.filter(
            (project) =>
              project.mode === 'central' &&
              (scopeProjectRefs ?? []).some(
                (scope) => scope.host === project.host && scope.project === project.project,
              ),
          )
        : []
  const displayProjectKeys = (centralMode ? centralProjects : standaloneProjects).map((project) =>
    sidebarProjectIdentity(projectSummaryTarget(project)),
  )

  // Default: the active project is open. This means the very first SSR HTML
  // already contains its experiment rows (no skeleton flash on initial nav).
  // Hydration matches because both server and client compute the same default.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeProjectKey ? [activeProjectKey] : []),
  )
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const stored = raw ? new Set(JSON.parse(raw) as string[]) : new Set<string>()
      // Always show the active Host-qualified project even if storage closed it.
      if (activeProjectKey) stored.add(activeProjectKey)
      setExpanded(stored)
    } catch {
      /* ignore */
    }
    setHydrated(true)
  }, [activeProjectKey])

  useEffect(() => {
    if (!hydrated) return
    try {
      const validNames = new Set(displayProjectKeys)
      const pruned = Array.from(expanded).filter((n) => validNames.has(n))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned))
    } catch {
      /* ignore */
    }
  }, [expanded, displayProjectKeys, hydrated])

  // Restored-from-storage expansion renders the section chrome, but it must
  // NOT fetch that project's experiment docs: on a non-project route
  // (`/manage/*`) every persisted section would otherwise fire a project
  // data read on mount — a cross-project fetch storm for pages that show no
  // project data. Only the active route's project and sections the user
  // opened in THIS session express intent to read project data.
  const [requested, setRequested] = useState<Set<string>>(new Set())

  const onToggle = (name: string, open: boolean) => {
    setExpanded((cur) => {
      const next = new Set(cur)
      if (open) next.add(name)
      else next.delete(name)
      return next
    })
    setRequested((cur) => {
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
      {centralMode ? (
        <SidebarContent className="overflow-y-auto">
          {(hostsData?.hosts ?? []).map((host) => {
            const hostProjects = centralProjects.filter((project) => project.host === host.host)
            return (
              <SidebarGroup key={host.host} data-slot="sidebar-host-group" data-host={host.host}>
                <div
                  data-slot="sidebar-host-header"
                  className="flex min-h-9 items-center gap-2 border-y border-sidebar-border bg-sidebar-accent/60 px-2 py-1.5 text-sidebar-foreground"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{host.label ?? host.host}</div>
                    {host.label && (
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {host.host}
                      </div>
                    )}
                  </div>
                  <HostStatusBadge availability={host} className="shrink-0" />
                </div>
                <SidebarGroupContent>
                  {hostProjects.map((project) => {
                    const target = projectSummaryTarget(project)
                    const identity = sidebarProjectIdentity(target)
                    return (
                      <ProjectGroup
                        key={identity}
                        target={target}
                        name={project.name}
                        basePath={sidebarProjectBasePath(target)}
                        central
                        isActive={identity === activeProjectKey}
                        isOpen={expanded.has(identity)}
                        readDocs={identity === activeProjectKey || requested.has(identity)}
                        activeNumber={activeNumber}
                        onOpenChange={(open) => onToggle(identity, open)}
                        onPillClick={() => setDiffDialogProject(target)}
                      />
                    )
                  })}
                  {hostProjects.length === 0 && (
                    <div className="px-2 py-2 text-xs text-muted-foreground">
                      No projects available
                    </div>
                  )}
                </SidebarGroupContent>
              </SidebarGroup>
            )
          })}
          {(hostsData?.hosts ?? []).length === 0 && (
            <SidebarGroup>
              <SidebarGroupContent className="px-3 py-2 text-xs text-sidebar-foreground/60">
                No Hosts configured
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
      ) : (
        <SidebarContent
          style={{
            gridTemplateRows: standaloneProjects
              .map((project) => {
                const identity = sidebarProjectIdentity(projectSummaryTarget(project))
                return expanded.has(identity)
                  ? `minmax(var(--sidebar-section-banner-h, 1.75rem), 1fr)`
                  : `minmax(var(--sidebar-section-banner-h, 1.75rem), 0fr)`
              })
              .join(' '),
          }}
          className="!grid !overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
        >
          {standaloneProjects.map((project) => {
            const target = projectSummaryTarget(project)
            const identity = sidebarProjectIdentity(target)
            return (
              <ProjectGroup
                key={identity}
                target={target}
                name={project.name}
                basePath={sidebarProjectBasePath(target)}
                central={false}
                isActive={identity === activeProjectKey}
                isOpen={expanded.has(identity)}
                readDocs={identity === activeProjectKey || requested.has(identity)}
                activeNumber={activeNumber}
                onOpenChange={(open) => onToggle(identity, open)}
                onPillClick={() => setDiffDialogProject(target)}
              />
            )
          })}
          {standaloneProjects.length === 0 && (
            <SidebarGroup>
              <SidebarGroupContent className="px-3 py-2 text-xs text-sidebar-foreground/60">
                No projects configured
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
      )}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          {role !== 'viewer' && !centralMode && <SlurmStatusWidget />}
          {role === 'owner' && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="sm" isActive={pathname === '/manage/file-access'}>
                <Link href="/manage/file-access">
                  <Gauge className="size-4" />
                  <span>File access</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
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
 *  Renders exactly one sub-section per expanded project — the Experiment
 *  inventory sorted by slug. Runs remain reachable through their parent
 *  Experiment, not via the sidebar. */
function ProjectGroup({
  target,
  name,
  basePath,
  central,
  isActive,
  isOpen,
  readDocs,
  activeNumber,
  onOpenChange,
  onPillClick,
}: {
  target: ProjectTarget
  name: string
  basePath: string
  central: boolean
  isActive: boolean
  isOpen: boolean
  /** True when this project's docs may be read: it owns the current route,
   *  or the user expanded its section in this session. Persisted expansion
   *  alone renders chrome without issuing a project data read. */
  readDocs: boolean
  activeNumber: number | null
  onOpenChange: (open: boolean) => void
  onPillClick: () => void
}) {
  // Same query key as the pill — TanStack dedupes. We use the result to
  // know whether to render the clickable wrapper at all. For non-git
  // projects (`enabled: false` or query pending) the pill returns null
  // and we skip the click target so nothing reactable sits in the row.
  const { data: gitStatus } = useQuery({
    queryKey: queryKeys.gitStatus(target),
    queryFn: () => fetchGitStatus(target),
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
      className={cn(
        'group/collapsible flex min-h-0 flex-col overflow-hidden',
        central && 'flex-none',
      )}
    >
      <SidebarGroup
        className={cn(
          'gap-0 py-0',
          // SidebarGroup now ALWAYS uses the flex chain so its inner
          // CollapsibleContent (`flex-1 min-h-0`) can resolve against
          // a known parent height. The flex-1/flex-none decision is
          // entirely up at the <Collapsible> level above.
          central ? 'flex flex-col' : 'flex min-h-0 flex-1 flex-col',
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
              <>
                {/* biome-ignore lint/a11y/useSemanticElements: an actual button would be invalid inside CollapsibleTrigger's button */}
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
                  <GitStatusPill project={target} variant="compact" className="shrink-0" />
                </span>
              </>
            ) : (
              <GitStatusPill project={target} variant="compact" className="shrink-0" />
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
        <CollapsibleContent forceMount className="flex-1 min-h-0 overflow-hidden">
          <div className="h-full overflow-y-auto">
            <SidebarGroupContent>
              <ProjectExperimentDocs
                project={target}
                basePath={basePath}
                activeNumber={isActive ? activeNumber : null}
                enabled={isOpen && readDocs}
              />
            </SidebarGroupContent>
          </div>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

/** Status-aware navigation shares list summaries and retains identity-only fallback. */
function ProjectExperimentDocs({
  project,
  basePath,
  activeNumber,
  enabled,
}: {
  project: ProjectTarget
  basePath: string
  activeNumber: number | null
  enabled: boolean
}) {
  // Persisted expansion alone does not authorize either query.
  const { data: inventory, isLoading } = useQuery({
    queryKey: queryKeys.experimentsInventory(project),
    queryFn: () => fetchExperimentsInventory(project),
    enabled,
    staleTime: 5_000,
  })
  const { data: summaries, isLoading: summariesLoading } = useQuery({
    queryKey: queryKeys.experiments(project),
    queryFn: () => fetchExperimentDocs(project),
    enabled,
    retry: false,
  })
  const docs = useMemo(() => {
    const rows = new Map<string, { id: string; summary?: ExperimentListRow }>()
    for (const item of inventory?.items ?? []) rows.set(item.id, { id: item.id })
    for (const summary of summaries?.experiments ?? [])
      rows.set(summary.id, { id: summary.id, summary })
    return [...rows.values()]
  }, [inventory?.items, summaries?.experiments])
  if (!enabled) return null
  if ((isLoading || summariesLoading) && docs.length === 0)
    return (
      <div
        data-slot="exp-list-loading"
        className="flex items-center justify-center py-3 text-sidebar-foreground/50"
      >
        <Loader2 className="size-4 animate-spin" aria-label="Loading experiments" />
      </div>
    )
  return (
    <div>
      {EXPERIMENT_GROUPS.map((group) => {
        const members = docs
          .filter((row) => experimentGroup(row.summary) === group.key)
          .sort((a, b) =>
            group.key !== 'UNKNOWN' && a.summary && b.summary
              ? compareExperimentNavigation(a.summary, b.summary)
              : a.id.localeCompare(b.id),
          )
        if (!members.length) return null
        return (
          <ExperimentNavigationGroup
            key={`${sidebarProjectIdentity(project)}:${group.key}`}
            group={group}
            count={members.length}
            compact
            forceOpen={members.some((row) => isActiveRow(row.id, activeNumber))}
          >
            <SidebarMenu>
              {members.map(({ id, summary }) => {
                const isActive = isActiveRow(id, activeNumber)
                const title = summary?.frontMatter.title || id
                const known = experimentGroup(summary) !== 'UNKNOWN'
                return (
                  <SidebarMenuItem key={id} className="flex w-full items-center">
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
                        className="h-auto min-h-12 min-w-0 flex-1 py-1.5 hover:bg-transparent data-[active=true]:bg-transparent"
                      >
                        <Link
                          href={`${basePath}/e/${artifactNumber(id) ?? encodeURIComponent(id)}`}
                          prefetch={false}
                          title={`${id} · ${title}`}
                          aria-current={isActive ? 'page' : undefined}
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {shortExperimentId(id)}
                              </span>
                              {known && summary ? (
                                <ExperimentStatusPill
                                  status={summary.displayStatus ?? summary.frontMatter.status}
                                  archived={summary.frontMatter.archived}
                                  className="px-1 py-0 text-[9px]"
                                />
                              ) : (
                                <span className="text-[9px] text-muted-foreground">Unknown</span>
                              )}
                            </div>
                            <div className="line-clamp-2 break-words text-xs leading-snug">
                              {title}
                            </div>
                          </div>
                        </Link>
                      </SidebarMenuButton>
                    </div>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </ExperimentNavigationGroup>
        )
      })}
    </div>
  )
}
