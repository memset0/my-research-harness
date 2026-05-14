'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Terminal } from 'lucide-react'
import {
  fetchExperimentDocs,
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
import { cn } from '../lib/utils'
import { useSession } from './session-provider'
import { SlurmStatusWidget } from './slurm-status-widget'

const DEFAULT_VISIBLE = 5
const STORAGE_KEY = 'memon:sidebar:expanded'

export function AppSidebar() {
  const { role, scopeProjects } = useSession()
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
      <SidebarHeader className="px-3 py-2">
        <Link
          href="/"
          className="font-mono text-lg font-bold tracking-tight text-sidebar-foreground"
        >
          memon
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {projects.map((p) => (
          <ProjectGroup
            key={p.name}
            name={p.name}
            isActive={p.name === activeProject}
            isOpen={expanded.has(p.name)}
            activeExpDocId={activeExpDocId}
            onOpenChange={(open) => onToggle(p.name, open)}
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
      <SidebarFooter>
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
    </Sidebar>
  )
}

/** One collapsible project group, following shadcn's
 *  Collapsible → SidebarGroup → GroupLabel(trigger) → GroupContent pattern.
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
}: {
  name: string
  isActive: boolean
  isOpen: boolean
  activeExpDocId: string
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange} className="group/collapsible">
      <SidebarGroup className="py-0">
        <SidebarGroupLabel
          asChild
          className={cn(
            'cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            isActive && 'text-sidebar-primary',
          )}
        >
          <CollapsibleTrigger>
            {name}
            <ChevronDown className="ml-auto size-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <ProjectExperimentDocs project={name} activeId={activeExpDocId} enabled={isOpen} />
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

/** v3 experiment-doc list, one entry per
 *  `<projectRoot>/docs/experiments/E*-<slug>.md`. The only sub-section
 *  rendered under each project group. Sorted by `effectiveUpdatedAt`
 *  descending so the most recently active experiment is at the top —
 *  matching the default sort on `experiment-card-grid.tsx`. */
function ProjectExperimentDocs({
  project,
  activeId,
  enabled,
}: {
  project: string
  activeId: string
  enabled: boolean
}) {
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
  const [showAll, setShowAll] = useState(false)
  const visible = useMemo(
    () => (showAll ? sorted : sorted.slice(0, DEFAULT_VISIBLE)),
    [sorted, showAll],
  )
  const hasMore = sorted.length > DEFAULT_VISIBLE
  if (!enabled) return null
  if (docs.length === 0 && !isLoading) {
    return null
  }
  return (
    <SidebarMenu>
      {visible.map((exp) => (
        <SidebarMenuItem key={exp.id}>
          <SidebarMenuButton asChild isActive={exp.id === activeId} size="sm">
            <Link
              href={`/p/${encodeURIComponent(project)}/e/${encodeURIComponent(exp.id)}`}
              title={exp.frontMatter.title}
            >
              <span className="truncate font-mono text-xs">{exp.id}</span>
              <span className="ml-auto shrink-0 text-[10px] text-sidebar-foreground/40">
                {exp.frontMatter.runs.length}
              </span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
      {hasMore && (
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            onClick={() => setShowAll((v) => !v)}
            className="text-sidebar-foreground/60"
          >
            {showAll ? 'Show fewer' : `View more (${sorted.length - DEFAULT_VISIBLE})`}
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  )
}
