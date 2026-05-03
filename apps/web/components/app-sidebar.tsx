'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { fetchExperiments, fetchProjects, type IndexedExperiment } from '../lib/api'
import {
  Sidebar,
  SidebarContent,
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
import { StatusPill } from './status-pill'
import { cn } from '../lib/utils'

const DEFAULT_VISIBLE = 5
const STORAGE_KEY = 'memon:sidebar:expanded'

export function AppSidebar() {
  const pathname = usePathname() ?? ''
  const activeProject = decodeURIComponent(pathname.match(/^\/p\/([^/]+)/)?.[1] ?? '')
  const activeExperimentId = decodeURIComponent(
    pathname.match(/\/experiments\/([^/]+)/)?.[1] ?? '',
  )

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 60_000,
  })
  const projects = projectsData?.projects ?? []

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
            activeExperimentId={activeExperimentId}
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
    </Sidebar>
  )
}

/** One collapsible project group, following shadcn's
 *  Collapsible → SidebarGroup → GroupLabel(trigger) → GroupContent pattern. */
function ProjectGroup({
  name,
  isActive,
  isOpen,
  activeExperimentId,
  onOpenChange,
}: {
  name: string
  isActive: boolean
  isOpen: boolean
  activeExperimentId: string
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
            <ProjectExperiments project={name} activeId={activeExperimentId} enabled={isOpen} />
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

function ProjectExperiments({
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
    queryFn: () => fetchExperiments(project),
    enabled,
    staleTime: 5_000,
  })
  const experiments: IndexedExperiment[] = data?.experiments ?? []
  const [showAll, setShowAll] = useState(false)
  const visible = useMemo(
    () => (showAll ? experiments : experiments.slice(0, DEFAULT_VISIBLE)),
    [experiments, showAll],
  )
  const hasMore = experiments.length > DEFAULT_VISIBLE

  if (isLoading && experiments.length === 0) {
    return <div className="px-2 py-1 text-xs text-sidebar-foreground/50">loading…</div>
  }
  if (experiments.length === 0) {
    return <div className="px-2 py-1 text-xs text-sidebar-foreground/50">no experiments</div>
  }

  return (
    <SidebarMenu>
      {visible.map((exp) => (
        <SidebarMenuItem key={exp.id}>
          <SidebarMenuButton asChild isActive={exp.id === activeId} size="sm">
            <Link
              href={`/p/${encodeURIComponent(project)}/experiments/${encodeURIComponent(exp.id)}`}
              title={exp.id}
            >
              <StatusPill status={exp.frontMatter.status} stale={exp.stale} />
              <span className="ml-1 truncate font-mono text-xs">{exp.id}</span>
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
            {showAll ? 'Show fewer' : `View more (${experiments.length - DEFAULT_VISIBLE})`}
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  )
}
