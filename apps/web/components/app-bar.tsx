'use client'

import { usePathname } from 'next/navigation'
import { type ProjectTarget, projectHost, projectName, projectRouteTarget } from '../lib/api'
import { type ProjectPage, parseProjectPath } from '../lib/project-routes'
import { ManageSharesDialog } from './manage-shares-dialog'
import { SidebarTrigger } from './ui/sidebar'

/** The section name of a project page; navigation itself lives in the sidebar. */
const SECTION_NAMES: Array<{ name: string; pages: readonly ProjectPage['kind'][] }> = [
  { name: 'Experiments', pages: ['overview', 'experiments', 'experiment'] },
  { name: 'Journal', pages: ['journal'] },
  { name: 'Reports', pages: ['reports', 'report'] },
  { name: 'Code Review', pages: ['code-reviews', 'code-review'] },
  { name: 'Wiki', pages: ['wiki-list', 'wiki'] },
]

export function AppBar({ project }: { project: ProjectTarget }) {
  const pathname = usePathname() ?? ''
  const target = projectRouteTarget(project)
  const parsed = parseProjectPath(pathname)
  const current =
    parsed && parsed.target.host === target.host && parsed.target.project === target.project
      ? parsed.page.kind
      : null
  const section = current ? SECTION_NAMES.find((entry) => entry.pages.includes(current)) : null
  const host = projectHost(project)

  return (
    <header className="sticky top-0 z-20 flex min-h-12 shrink-0 items-center gap-2 border-b bg-background px-3 py-1.5 md:px-4">
      <SidebarTrigger />
      <nav
        aria-label="Location"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-sm"
        data-app-bar-location=""
      >
        {host && <span className="shrink-0 font-mono text-xs text-muted-foreground">{host}</span>}
        {host && <span className="text-muted-foreground/50">/</span>}
        <span className="truncate font-medium">{projectName(project)}</span>
        {section && <span className="text-muted-foreground/50">/</span>}
        {section && <span className="shrink-0 text-muted-foreground">{section.name}</span>}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <ManageSharesDialog project={project} />
      </div>
    </header>
  )
}
