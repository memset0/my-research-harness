'use client'

import type { HostAvailability } from '@memon/core'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  ChevronRight,
  FileText,
  FlaskConical,
  Gauge,
  GitPullRequest,
  GripVertical,
  Loader2,
  NotebookPen,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  type ExperimentListRow,
  fetchExperimentDocs,
  fetchExperimentsInventory,
  fetchGitStatus,
  fetchHosts,
  fetchProjects,
  fetchReports,
  fetchWiki,
  type ProjectSummary,
  type ProjectTarget,
  projectHost,
  projectName,
  projectRouteTarget,
} from '../lib/api'
import {
  compareExperimentNavigation,
  EXPERIMENT_GROUPS,
  experimentGroup,
  shortExperimentId,
} from '../lib/experiment-navigation'
import {
  artifactNumber,
  type ProjectPage,
  parseProjectPath,
  projectBasePath,
  projectOfPath,
  projectPagePath,
} from '../lib/project-routes'
import { queryKeys } from '../lib/query-keys'
import { useUserPreferenceState } from '../lib/use-user-preference-state'
import { cn } from '../lib/utils'
import { ExperimentNavigationGroup } from './experiment-navigation-group'
import { GitDiffDialog } from './git-diff-dialog'
import { GitStatusPill } from './git-status-pill'
import { HOST_STATUS_PRESENTATION } from './host-status-badge'
import { useIsDocumentOnlyViewer, useSession } from './session-provider'
import { SidebarResizeHandle } from './sidebar-resize-handle'
import { SlurmStatusWidget } from './slurm-status-widget'
import { ExperimentStatusPill } from './status-pill'
import { TabBadge, type TabKind } from './tab-badge'
import { ThemeToggle } from './theme-toggle'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar'

/** Open projects and sections (`<project identity>` / `<identity>#<section>`), per browser. */
const STORAGE_KEY = 'memon:sidebar:expanded'
/** The owner's project order (project identities), synced like other preferences. */
const PROJECT_ORDER_KEY = 'memon:sidebar:project-order'

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

type SectionKey = 'experiments' | 'journal' | 'reports' | 'code-review' | 'wiki'

interface SectionSpec {
  key: SectionKey
  name: string
  icon: typeof FlaskConical
  badge: TabKind
  page: ProjectPage
  /** Page kinds that make this section current. */
  pages: readonly ProjectPage['kind'][]
  /** Sections that list their items when expanded. */
  expandable: boolean
}

const SECTIONS: SectionSpec[] = [
  {
    key: 'experiments',
    name: 'Experiments',
    icon: FlaskConical,
    badge: 'experiments',
    page: { kind: 'overview' },
    pages: ['overview', 'experiments', 'experiment'],
    expandable: true,
  },
  {
    key: 'journal',
    name: 'Journal',
    icon: NotebookPen,
    badge: 'journal',
    page: { kind: 'journal' },
    pages: ['journal'],
    expandable: false,
  },
  {
    key: 'reports',
    name: 'Reports',
    icon: FileText,
    badge: 'reports',
    page: { kind: 'reports' },
    pages: ['reports', 'report'],
    expandable: true,
  },
  {
    key: 'code-review',
    name: 'Code Review',
    icon: GitPullRequest,
    badge: 'code-review',
    page: { kind: 'code-reviews' },
    pages: ['code-reviews', 'code-review'],
    expandable: false,
  },
  {
    key: 'wiki',
    name: 'Wiki',
    icon: BookOpen,
    badge: 'wiki',
    page: { kind: 'wiki-list' },
    pages: ['wiki-list', 'wiki'],
    expandable: true,
  },
]

interface ActiveLocation {
  identity: string
  section: SectionKey | null
  /** The open Experiment / Report / Wiki number, if any. */
  number: number | null
}

function activeLocation(pathname: string): ActiveLocation | null {
  const target = projectOfPath(pathname) as ProjectTarget | null
  if (!target) return null
  const page = parseProjectPath(pathname)?.page
  const section = page
    ? (SECTIONS.find((spec) => spec.pages.includes(page.kind))?.key ?? null)
    : null
  const number =
    page && (page.kind === 'experiment' || page.kind === 'report' || page.kind === 'wiki')
      ? page.number
      : null
  return { identity: sidebarProjectIdentity(target), section, number }
}

/** Projects in the saved order; projects the order does not know yet follow in API order. */
export function orderProjects<T>(
  projects: T[],
  identity: (project: T) => string,
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((key, index) => [key, index]))
  return projects
    .map((project, index) => ({ project, index, rank: rank.get(identity(project)) }))
    .sort(
      (a, b) =>
        (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map((entry) => entry.project)
}

/** Move `dragged` to `target`'s position (before it when moving up, after it when moving down). */
export function moveProject(order: readonly string[], dragged: string, target: string): string[] {
  const from = order.indexOf(dragged)
  const to = order.indexOf(target)
  if (from < 0 || to < 0 || from === to) return [...order]
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, dragged)
  return next
}

export function AppSidebar() {
  const { role, scopeProjects, scopeProjectRefs } = useSession()
  const documentOnly = useIsDocumentOnlyViewer()
  const [diffDialogProject, setDiffDialogProject] = useState<ProjectTarget | null>(null)
  const pathname = usePathname() ?? ''
  const active = activeLocation(pathname)

  const { data: projectsData, isError: projectsFailed } = useQuery({
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
  const hosts = useMemo(
    () => new Map((hostsData?.hosts ?? []).map((host) => [host.host, host])),
    [hostsData],
  )
  const allProjects = projectsData?.projects ?? []
  const visible = allProjects.filter((project) =>
    project.mode === 'central'
      ? role === 'owner' ||
        (role === 'viewer' &&
          (scopeProjectRefs ?? []).some(
            (scope) => scope.host === project.host && scope.project === project.project,
          ))
      : role !== 'viewer' || scopeProjects.includes(project.project),
  )
  const identityOf = (project: ProjectSummary) =>
    sidebarProjectIdentity(projectSummaryTarget(project))

  const [storedOrder, setStoredOrder] = useUserPreferenceState<string[]>(PROJECT_ORDER_KEY, [])
  const order = Array.isArray(storedOrder) ? storedOrder : []
  const projects = orderProjects(visible, identityOf, order)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const drop = (target: string) => {
    if (dragging && dragging !== target)
      setStoredOrder(moveProject(projects.map(identityOf), dragging, target))
    setDragging(null)
    setDropTarget(null)
  }

  // The active project and section are always open, so the current page is
  // visible in the tree without any click.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      setExpanded(new Set(raw ? (JSON.parse(raw) as string[]) : []))
    } catch {
      /* ignore */
    }
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]))
    } catch {
      /* ignore */
    }
  }, [expanded, hydrated])
  const isOpen = (key: string): boolean =>
    expanded.has(key) ||
    (active !== null &&
      (key === active.identity ||
        (active.section !== null && key === `${active.identity}#${active.section}`)))
  // Restored expansion renders the tree without reading project data: only
  // the active project and projects opened in this session list their items,
  // so a non-project page never fans out reads to every project.
  const [requested, setRequested] = useState<Set<string>>(() => new Set())
  const toggle = (key: string, open: boolean) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
    if (open) setRequested((current) => new Set(current).add(key.split('#')[0]!))
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
      <SidebarContent className="gap-0 overflow-y-auto px-2 py-1" data-slot="sidebar-projects">
        {projects.map((project) => {
          const target = projectSummaryTarget(project)
          const identity = identityOf(project)
          return (
            <ProjectNode
              key={identity}
              target={target}
              identity={identity}
              name={project.name}
              host={project.mode === 'central' ? hosts.get(project.host) : undefined}
              hostName={project.mode === 'central' ? project.host : null}
              active={active?.identity === identity ? active : null}
              open={isOpen(identity)}
              isSectionOpen={(section) => isOpen(`${identity}#${section}`)}
              readItems={active?.identity === identity || requested.has(identity)}
              onToggle={(open) => toggle(identity, open)}
              onToggleSection={(section, open) => toggle(`${identity}#${section}`, open)}
              onPillClick={() => setDiffDialogProject(target)}
              showSections={!documentOnly}
              draggable={projects.length > 1}
              dragging={dragging === identity}
              dropTarget={dropTarget === identity && dragging !== identity}
              onDragStart={() => setDragging(identity)}
              onDragEnter={() => setDropTarget(identity)}
              onDrop={() => drop(identity)}
              onDragEnd={() => {
                setDragging(null)
                setDropTarget(null)
              }}
            />
          )
        })}
        {projects.length === 0 && (
          <div className="px-2 py-3 text-xs text-sidebar-foreground/60">
            {projectsData
              ? 'No projects available'
              : projectsFailed
                ? 'Projects are unavailable'
                : 'Loading projects…'}
          </div>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          {role !== 'viewer' && hostsData === undefined && <SlurmStatusWidget />}
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

/** A compact host chip: the Host id with its availability as a colored dot. */
function HostChip({ host, availability }: { host: string; availability?: HostAvailability }) {
  const presentation = availability ? HOST_STATUS_PRESENTATION[availability.state] : null
  return (
    <span
      data-slot="sidebar-project-host"
      title={presentation ? `${host}: ${presentation.label}` : host}
      className="flex shrink-0 items-center gap-1 rounded border border-sidebar-border px-1 font-mono text-[10px] font-normal normal-case tracking-normal text-muted-foreground"
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          !presentation && 'bg-muted-foreground/40',
          presentation?.tone === 'success' && 'bg-emerald-500',
          presentation?.tone === 'warning' && 'bg-amber-500',
          presentation?.tone === 'danger' && 'bg-red-500',
          presentation?.tone === 'neutral' && 'bg-muted-foreground/60',
        )}
      />
      {host}
    </span>
  )
}

function ProjectNode({
  target,
  identity,
  name,
  host,
  hostName,
  active,
  open,
  isSectionOpen,
  readItems,
  onToggle,
  onToggleSection,
  onPillClick,
  showSections,
  draggable,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: {
  target: ProjectTarget
  identity: string
  name: string
  host?: HostAvailability
  hostName: string | null
  active: ActiveLocation | null
  open: boolean
  isSectionOpen: (section: SectionKey) => boolean
  readItems: boolean
  onToggle: (open: boolean) => void
  onToggleSection: (section: SectionKey, open: boolean) => void
  onPillClick: () => void
  showSections: boolean
  draggable: boolean
  dragging: boolean
  dropTarget: boolean
  onDragStart: () => void
  onDragEnter: () => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  const { data: gitStatus } = useQuery({
    queryKey: queryKeys.gitStatus(target),
    queryFn: () => fetchGitStatus(target),
    staleTime: 5_000,
    retry: false,
  })
  const gitEnabled = gitStatus?.enabled === true
  return (
    <Collapsible
      open={open}
      onOpenChange={onToggle}
      data-slot="sidebar-project"
      data-project={identity}
      className={cn(
        'rounded-md border border-transparent',
        dragging && 'opacity-50',
        dropTarget && 'border-sidebar-primary',
      )}
      onDragOver={(event) => {
        if (!draggable) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDragEnter={onDragEnter}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer drag to reorder; the row's controls stay keyboard reachable */}
      <div
        className={cn(
          'group/project flex h-8 items-center gap-1 rounded-md pr-1 text-sidebar-foreground hover:bg-sidebar-accent',
          active && 'text-sidebar-primary',
        )}
        draggable={draggable}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', identity)
          onDragStart()
        }}
        onDragEnd={onDragEnd}
      >
        {draggable ? (
          <GripVertical
            aria-hidden
            className="size-3.5 shrink-0 cursor-grab text-muted-foreground/0 group-hover/project:text-muted-foreground/70"
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <CollapsibleTrigger className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRight
            aria-hidden
            className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{name}</span>
        </CollapsibleTrigger>
        {hostName && <HostChip host={hostName} availability={host} />}
        {gitEnabled ? (
          <button
            type="button"
            data-slot="git-status-pill-trigger"
            aria-label={`View git diff for ${name}`}
            onClick={onPillClick}
            className="shrink-0 cursor-pointer rounded px-1 hover:bg-accent hover:text-accent-foreground"
          >
            <GitStatusPill project={target} variant="compact" className="shrink-0" />
          </button>
        ) : (
          <GitStatusPill project={target} variant="compact" className="shrink-0" />
        )}
      </div>
      <CollapsibleContent>
        {showSections && (
          <SidebarMenu className="gap-0 pb-1 pl-4">
            {SECTIONS.map((section) => (
              <SectionNode
                key={section.key}
                project={target}
                section={section}
                active={active?.section === section.key ? active : null}
                open={section.expandable && isSectionOpen(section.key)}
                onToggle={(next) => onToggleSection(section.key, next)}
                readItems={open && readItems}
                showCount={readItems}
              />
            ))}
          </SidebarMenu>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function SectionNode({
  project,
  section,
  active,
  open,
  onToggle,
  readItems,
  showCount,
}: {
  project: ProjectTarget
  section: SectionSpec
  active: ActiveLocation | null
  open: boolean
  onToggle: (open: boolean) => void
  readItems: boolean
  /** Counts read project data, so restored-only projects show none. */
  showCount: boolean
}) {
  const href = projectPagePath(projectRouteTarget(project), section.page)
  const current = active !== null && active.number === null
  const Icon = section.icon
  return (
    <SidebarMenuItem data-slot="sidebar-section" data-section={section.key}>
      <div className="flex items-center">
        {section.expandable ? (
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${section.name}`}
            aria-expanded={open}
            onClick={() => onToggle(!open)}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ChevronRight
              aria-hidden
              className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <SidebarMenuButton
          asChild
          size="sm"
          isActive={current}
          className={cn('min-w-0 flex-1', active && !current && 'text-sidebar-primary')}
        >
          <Link href={href} prefetch={false} aria-current={current ? 'page' : undefined}>
            <Icon className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">{section.name}</span>
            {showCount && <TabBadge kind={section.badge} project={project} active={current} />}
          </Link>
        </SidebarMenuButton>
      </div>
      {open && (
        <div className="ml-6 border-l border-sidebar-border pl-1">
          {section.key === 'experiments' && (
            <ExperimentItems
              project={project}
              activeNumber={active?.number ?? null}
              enabled={readItems}
            />
          )}
          {section.key === 'reports' && (
            <ReportItems
              project={project}
              activeNumber={active?.number ?? null}
              enabled={readItems}
            />
          )}
          {section.key === 'wiki' && (
            <WikiItems
              project={project}
              activeNumber={active?.number ?? null}
              enabled={readItems}
            />
          )}
        </div>
      )}
    </SidebarMenuItem>
  )
}

/** Scrolls the open item into view once it renders, so the tree shows where the page is. */
function useRevealWhenActive(active: boolean) {
  const ref = useRef<HTMLAnchorElement | null>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return ref
}

function ItemLink({
  href,
  active,
  title,
  children,
}: {
  href: string
  active: boolean
  title: string
  children: ReactNode
}) {
  const ref = useRevealWhenActive(active)
  return (
    <Link
      ref={ref}
      href={href}
      prefetch={false}
      title={title}
      aria-current={active ? 'page' : undefined}
      data-sidebar-item=""
      className={cn(
        'block rounded-md px-2 py-1 text-xs leading-snug transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
      )}
    >
      {children}
    </Link>
  )
}

function ItemsLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-sidebar-foreground/50">
      <Loader2 className="size-3.5 animate-spin" aria-label={label} />
    </div>
  )
}

function ItemsEmpty({ text }: { text: string }) {
  return <div className="px-2 py-1.5 text-xs text-sidebar-foreground/50">{text}</div>
}

function ReportItems({
  project,
  activeNumber,
  enabled,
}: {
  project: ProjectTarget
  activeNumber: number | null
  enabled: boolean
}) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports(project),
    queryFn: () => fetchReports(project),
    enabled,
    staleTime: 5_000,
  })
  const target = projectRouteTarget(project)
  const reports = data?.reports ?? []
  if (!enabled) return null
  if (isLoading && reports.length === 0) return <ItemsLoading label="Loading reports" />
  if (reports.length === 0) return <ItemsEmpty text="No reports" />
  return (
    <div className="flex flex-col py-0.5">
      {reports.map((report) => {
        const number = artifactNumber(report.id)
        if (number === null) return null
        return (
          <ItemLink
            key={report.id}
            href={projectPagePath(target, { kind: 'report', number })}
            active={number === activeNumber}
            title={`${report.id} · ${report.title ?? ''}`}
          >
            <span className="mr-1.5 font-mono text-[10px] text-muted-foreground">{report.id}</span>
            <span className="break-words">{report.title ?? report.slug}</span>
          </ItemLink>
        )
      })}
    </div>
  )
}

function WikiItems({
  project,
  activeNumber,
  enabled,
}: {
  project: ProjectTarget
  activeNumber: number | null
  enabled: boolean
}) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.wiki(project),
    queryFn: () => fetchWiki(project),
    enabled,
    staleTime: 5_000,
  })
  const target = projectRouteTarget(project)
  const pages = useMemo(
    () => [...(data?.pages ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    [data],
  )
  if (!enabled) return null
  if (isLoading && pages.length === 0) return <ItemsLoading label="Loading wiki pages" />
  if (pages.length === 0) return <ItemsEmpty text="No wiki pages" />
  return (
    <div className="flex flex-col py-0.5">
      {pages.map((page) => {
        const number = artifactNumber(page.id)
        if (number === null) return null
        return (
          <ItemLink
            key={page.id}
            href={projectPagePath(target, { kind: 'wiki', number })}
            active={number === activeNumber}
            title={`${page.id} · ${page.title}`}
          >
            <span className="mr-1.5 font-mono text-[10px] text-muted-foreground">{page.id}</span>
            <span className="break-words">{page.title}</span>
          </ItemLink>
        )
      })}
    </div>
  )
}

/** Status-grouped Experiments; list summaries fill in over the identity-only inventory. */
function ExperimentItems({
  project,
  activeNumber,
  enabled,
}: {
  project: ProjectTarget
  activeNumber: number | null
  enabled: boolean
}) {
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
  const target = projectRouteTarget(project)
  if (!enabled) return null
  if ((isLoading || summariesLoading) && docs.length === 0)
    return <ItemsLoading label="Loading experiments" />
  if (docs.length === 0) return <ItemsEmpty text="No experiments" />
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
            forceOpen={members.some((row) => artifactNumber(row.id) === activeNumber)}
          >
            <div className="flex flex-col">
              {members.map(({ id, summary }) => {
                const number = artifactNumber(id)
                const title = summary?.frontMatter.title || id
                const known = experimentGroup(summary) !== 'UNKNOWN'
                return (
                  <ItemLink
                    key={id}
                    href={
                      number === null
                        ? projectPagePath(target, { kind: 'overview' })
                        : projectPagePath(target, { kind: 'experiment', number })
                    }
                    active={number !== null && number === activeNumber}
                    title={`${id} · ${title}`}
                  >
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
                    <div className="line-clamp-2 break-words">{title}</div>
                  </ItemLink>
                )
              })}
            </div>
          </ExperimentNavigationGroup>
        )
      })}
    </div>
  )
}
