'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { fetchExperiments, fetchProjects, type IndexedExperiment } from '../lib/api'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const arr = JSON.parse(raw) as string[]
        setExpanded(new Set(arr))
      }
    } catch {
      /* ignore */
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      // Prune entries no longer in config
      const validNames = new Set(projects.map((p) => p.name))
      const pruned = Array.from(expanded).filter((n) => validNames.has(n))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned))
    } catch {
      /* ignore */
    }
  }, [expanded, projects, hydrated])

  const toggle = (name: string) => {
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(name)) next.delete(name)
      else next.add(name)
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
        <SidebarGroup>
          <SidebarMenu>
            {projects.map((p) => {
              const isOpen = expanded.has(p.name)
              const isActive = p.name === activeProject
              return (
                <ProjectGroup
                  key={p.name}
                  name={p.name}
                  isOpen={isOpen}
                  isActive={isActive}
                  activeExperimentId={activeExperimentId}
                  onToggle={() => toggle(p.name)}
                />
              )
            })}
            {projects.length === 0 && (
              <li className="px-3 py-2 text-xs text-sidebar-foreground/60">
                No projects configured
              </li>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

function ProjectGroup({
  name,
  isOpen,
  isActive,
  activeExperimentId,
  onToggle,
}: {
  name: string
  isOpen: boolean
  isActive: boolean
  activeExperimentId: string
  onToggle: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['experiments', name],
    queryFn: () => fetchExperiments(name),
    enabled: isOpen,
    staleTime: 5_000,
  })
  const experiments: IndexedExperiment[] = data?.experiments ?? []

  const [showAll, setShowAll] = useState(false)
  const visible = useMemo(
    () => (showAll ? experiments : experiments.slice(0, DEFAULT_VISIBLE)),
    [experiments, showAll],
  )
  const hasMore = experiments.length > DEFAULT_VISIBLE

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={isActive && !activeExperimentId}
            className={cn('font-medium', isActive && 'text-sidebar-primary')}
          >
            <ChevronRight className="size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
            <Link
              href={`/p/${encodeURIComponent(name)}`}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 truncate"
            >
              {name}
            </Link>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {isLoading && experiments.length === 0 && (
              <SidebarMenuSubItem>
                <div className="px-2 py-1 text-xs text-sidebar-foreground/50">loading…</div>
              </SidebarMenuSubItem>
            )}
            {visible.map((exp) => (
              <SidebarMenuSubItem key={exp.id}>
                <SidebarMenuSubButton asChild isActive={exp.id === activeExperimentId}>
                  <Link
                    href={`/p/${encodeURIComponent(name)}/experiments/${encodeURIComponent(exp.id)}`}
                    title={exp.id}
                  >
                    <StatusPill status={exp.frontMatter.status} stale={exp.stale} />
                    <span className="ml-1 truncate font-mono text-xs">{exp.id}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
            {hasMore && (
              <SidebarMenuSubItem>
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="w-full rounded px-2 py-1 text-left text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  {showAll
                    ? `Show fewer`
                    : `View more (${experiments.length - DEFAULT_VISIBLE})`}
                </button>
              </SidebarMenuSubItem>
            )}
            {!isLoading && experiments.length === 0 && (
              <SidebarMenuSubItem>
                <div className="px-2 py-1 text-xs text-sidebar-foreground/50">
                  no experiments
                </div>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}
