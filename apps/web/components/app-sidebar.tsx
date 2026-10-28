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
  Loader2,
  NotebookPen,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchExperimentDocs,
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
import { experimentGroup, shortExperimentId } from '../lib/experiment-navigation'
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
import { GitDiffDialog } from './git-diff-dialog'
import { GitStatusPill } from './git-status-pill'
import { HOST_STATUS_PRESENTATION } from './host-status-badge'
import { useIsDocumentOnlyViewer, useSession } from './session-provider'
import { SidebarResizeHandle } from './sidebar-resize-handle'
import { SlurmStatusWidget } from './slurm-status-widget'
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
  page: ProjectPage
  /** Page kinds that make this section current. */
  pages: readonly ProjectPage['kind'][]
  /** Sections that list their items when expanded. */
  expandable: boolean
}

const SECTIONS: SectionSpec[] = [
  {
    key: 'wiki',
    name: 'Wiki',
    icon: BookOpen,
    page: { kind: 'wiki-list' },
    pages: ['wiki-list', 'wiki'],
    expandable: true,
  },
  {
    key: 'experiments',
    name: 'Experiments',
    icon: FlaskConical,
    page: { kind: 'overview' },
    pages: ['overview', 'experiments', 'experiment'],
    expandable: true,
  },
  {
    key: 'reports',
    name: 'Reports',
    icon: FileText,
    page: { kind: 'reports' },
    pages: ['reports', 'report'],
    expandable: true,
  },
  {
    key: 'code-review',
    name: 'Code Review',
    icon: GitPullRequest,
    page: { kind: 'code-reviews' },
    pages: ['code-reviews', 'code-review'],
    expandable: false,
  },
  {
    key: 'journal',
    name: 'Journal',
    icon: NotebookPen,
    page: { kind: 'journal' },
    pages: ['journal'],
    expandable: false,
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

  // Nothing is open by default except the current page's project and
  // section. Clicks override that for this session only; a project lists its
  // items only while open, so no page fans out reads to every project.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map())
  const isOpen = (key: string): boolean =>
    overrides.get(key) ??
    (active !== null &&
      (key === active.identity ||
        (active.section !== null && key === `${active.identity}#${active.section}`)))
  const toggle = (key: string, open: boolean) =>
    setOverrides((current) => new Map(current).set(key, open))

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
        'rounded-md',
        dragging && 'opacity-40',
        dropTarget && 'ring-1 ring-sidebar-primary/60',
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the whole row drags to reorder; its controls stay keyboard reachable */}
      <div
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-md px-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent',
          active && 'text-sidebar-accent-foreground',
        )}
        draggable={draggable}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', identity)
          onDragStart()
        }}
        onDragEnd={onDragEnd}
      >
        <CollapsibleTrigger className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[13px] font-medium',
              active && 'font-semibold',
            )}
          >
            {name}
          </span>
        </CollapsibleTrigger>
        {hostName && <HostChip host={hostName} availability={host} />}
        {gitEnabled ? (
          <button
            type="button"
            data-slot="git-status-pill-trigger"
            aria-label={`View git diff for ${name}`}
            onClick={onPillClick}
            className="shrink-0 cursor-pointer rounded hover:bg-accent hover:text-accent-foreground"
          >
            <GitStatusPill project={target} variant="compact" className="shrink-0" />
          </button>
        ) : (
          <GitStatusPill project={target} variant="compact" className="shrink-0" />
        )}
      </div>
      <CollapsibleContent>
        {showSections && (
          <SidebarMenu className="gap-px pt-0.5 pb-2 pl-3.5">
            {SECTIONS.map((section) => (
              <SectionNode
                key={section.key}
                project={target}
                section={section}
                active={active?.section === section.key ? active : null}
                open={section.expandable && isSectionOpen(section.key)}
                onToggle={(next) => onToggleSection(section.key, next)}
                readItems={open}
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
}: {
  project: ProjectTarget
  section: SectionSpec
  active: ActiveLocation | null
  open: boolean
  onToggle: (open: boolean) => void
  readItems: boolean
}) {
  const href = projectPagePath(projectRouteTarget(project), section.page)
  const current = active !== null && active.number === null
  const Icon = section.icon
  return (
    <SidebarMenuItem data-slot="sidebar-section" data-section={section.key}>
      <div className="group/section relative flex items-center">
        <SidebarMenuButton
          asChild
          size="sm"
          isActive={current}
          className={cn('min-w-0 flex-1 pr-7', active && !current && 'font-medium')}
        >
          <Link href={href} prefetch={false} aria-current={current ? 'page' : undefined}>
            <Icon className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{section.name}</span>
          </Link>
        </SidebarMenuButton>
        {section.expandable && (
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${section.name}`}
            aria-expanded={open}
            onClick={() => onToggle(!open)}
            className={cn(
              'absolute right-1 flex size-5 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              !open && 'opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100',
            )}
          >
            <ChevronRight
              aria-hidden
              className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            />
          </button>
        )}
      </div>
      {open && (
        <div className="mt-px mb-1 ml-[0.9rem] flex flex-col gap-px border-l border-sidebar-border pl-2">
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
  id,
  title,
}: {
  href: string
  active: boolean
  id: string
  title: string
}) {
  const ref = useRevealWhenActive(active)
  return (
    <Link
      ref={ref}
      href={href}
      prefetch={false}
      title={`${id} · ${title}`}
      aria-current={active ? 'page' : undefined}
      data-sidebar-item=""
      className={cn(
        'flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
      )}
    >
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
        {id.replace(/^([A-Z])0+(?=\d)/, '$1')}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </Link>
  )
}

function ItemsLoading({ label }: { label: string }) {
  return (
    <div className="flex h-7 items-center px-2 text-sidebar-foreground/50">
      <Loader2 className="size-3.5 animate-spin" aria-label={label} />
    </div>
  )
}

function ItemsEmpty({ text }: { text: string }) {
  return <div className="flex h-7 items-center px-2 text-xs text-sidebar-foreground/50">{text}</div>
}

/** Newest first: the declared update time, else the file time. */
function byRecency<T>(items: readonly T[], time: (item: T) => number): T[] {
  return [...items].sort((a, b) => time(b) - time(a))
}

function timeOf(updatedAt: string | null | undefined, mtime: number | undefined): number {
  const declared = updatedAt ? Date.parse(updatedAt) : Number.NaN
  return Number.isFinite(declared) ? declared : (mtime ?? 0)
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
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.reports(project),
    queryFn: () => fetchReports(project),
    enabled,
    staleTime: 5_000,
  })
  const target = projectRouteTarget(project)
  const reports = useMemo(
    () => byRecency(data?.reports ?? [], (report) => timeOf(report.updatedAt, report.mtime)),
    [data],
  )
  if (!enabled) return null
  if (isLoading && reports.length === 0) return <ItemsLoading label="Loading reports" />
  if (reports.length === 0)
    return <ItemsEmpty text={isError ? 'Reports failed to load' : 'No reports'} />
  return (
    <>
      {reports.map((report) => {
        const number = artifactNumber(report.id)
        if (number === null) return null
        return (
          <ItemLink
            key={report.id}
            id={report.id}
            href={projectPagePath(target, { kind: 'report', number })}
            active={number === activeNumber}
            title={report.title ?? report.slug}
          />
        )
      })}
    </>
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
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.wiki(project),
    queryFn: () => fetchWiki(project),
    enabled,
    staleTime: 5_000,
  })
  const target = projectRouteTarget(project)
  const pages = useMemo(
    () => byRecency(data?.pages ?? [], (page) => timeOf(page.updatedAt, page.mtime)),
    [data],
  )
  if (!enabled) return null
  if (isLoading && pages.length === 0) return <ItemsLoading label="Loading wiki pages" />
  if (pages.length === 0)
    return <ItemsEmpty text={isError ? 'Wiki failed to load' : 'No wiki pages'} />
  return (
    <>
      {pages.map((page) => {
        const number = artifactNumber(page.id)
        if (number === null) return null
        return (
          <ItemLink
            key={page.id}
            id={page.id}
            href={projectPagePath(target, { kind: 'wiki', number })}
            active={number === activeNumber}
            title={page.title}
          />
        )
      })}
    </>
  )
}

/** Active Experiments only, newest first; other statuses live on the Experiments page. */
function ExperimentItems({
  project,
  activeNumber,
  enabled,
}: {
  project: ProjectTarget
  activeNumber: number | null
  enabled: boolean
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.experiments(project),
    queryFn: () => fetchExperimentDocs(project),
    enabled,
    retry: false,
  })
  const target = projectRouteTarget(project)
  const experiments = useMemo(
    () =>
      byRecency(
        (data?.experiments ?? []).filter((row) => experimentGroup(row) === 'ACTIVE'),
        (row) => timeOf(row.effectiveUpdatedAt, row.readmeMtime),
      ),
    [data],
  )
  if (!enabled) return null
  if (isLoading && experiments.length === 0) return <ItemsLoading label="Loading experiments" />
  if (experiments.length === 0)
    return <ItemsEmpty text={isError ? 'Experiments failed to load' : 'No active experiments'} />
  return (
    <>
      {experiments.map((row) => {
        const number = artifactNumber(row.id)
        if (number === null) return null
        return (
          <ItemLink
            key={row.id}
            id={shortExperimentId(row.id)}
            href={projectPagePath(target, { kind: 'experiment', number })}
            active={number === activeNumber}
            title={row.frontMatter.title || row.id}
          />
        )
      })}
    </>
  )
}
