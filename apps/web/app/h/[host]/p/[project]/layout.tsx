import { type HostAvailability, isUsableHostAvailabilityState, ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { AppBar } from '../../../../../components/app-bar'
import { AppSidebar } from '../../../../../components/app-sidebar'
import { CentralProjectUnavailable } from '../../../../../components/central-project-unavailable'
import { ProjectFooter } from '../../../../../components/project-footer'
import { ResizableSidebarProvider } from '../../../../../components/resizable-sidebar-provider'
import { SidebarInset, SidebarTrigger } from '../../../../../components/ui/sidebar'
import { WorkspaceSplitOutlet } from '../../../../../components/workspace-pane-provider'
import { readIdentityFromHeaders } from '../../../../../lib/auth/request-context'
import { aggregateCentralProjects } from '../../../../../lib/central/central-projects'
import { servesProjectsDirectly } from '../../../../../lib/central/direct-projects'
import { directCentralRuntime } from '../../../../../lib/central/direct-runtime'
import { getCentralFleet } from '../../../../../lib/central/fleet-runtime'
import { centralProjectTitle } from '../../../../../lib/central/project-metadata'
import { getRuntime } from '../../../../../lib/runtime'

interface Params {
  host: string
  project: string
}

function decodedRef(params: Params) {
  return ProjectRefSchema.safeParse({
    host: decodeURIComponent(params.host),
    project: decodeURIComponent(params.project),
  })
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const parsed = decodedRef(await params)
  if (!parsed.success) return { title: 'Project' }
  const title = centralProjectTitle(parsed.data)
  if (!title) return { title: 'Project' }
  return {
    title,
  }
}

export default async function CentralProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<Params>
}) {
  const parsed = decodedRef(await params)
  if (!parsed.success) notFound()
  const identity = await readIdentityFromHeaders()
  if (identity.role === 'anon') notFound()
  if (
    identity.role === 'viewer' &&
    !identity.scopeProjectRefs.some(
      (scope) => scope.host === parsed.data.host && scope.project === parsed.data.project,
    )
  ) {
    notFound()
  }
  const runtime = await getRuntime()
  const directProject = servesProjectsDirectly(runtime.config)
    ? directCentralRuntime(runtime.config).registry.resolve(parsed.data.host, parsed.data.project)
    : null
  let availability: HostAvailability | null = null
  let usable = directProject !== null
  if (!directProject) {
    const fleet = await getCentralFleet().catch(() => null)
    if (!fleet) notFound()
    const projects = await aggregateCentralProjects({
      registry: fleet.registry,
      actor:
        identity.role === 'viewer'
          ? { role: 'viewer', scopes: identity.scopeProjectRefs }
          : { role: 'owner' },
    })
    availability = fleet.registry.getAvailability(parsed.data.host)
    if (!availability) notFound()
    usable = isUsableHostAvailabilityState(availability.state)
    if (
      usable &&
      !projects.projects.some(
        (project) => project.host === parsed.data.host && project.project === parsed.data.project,
      )
    )
      notFound()
  }

  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get('sidebar_state')?.value !== 'false'
  if (!usable && availability) {
    return (
      <ResizableSidebarProvider defaultOpen={defaultOpen} className="h-svh min-h-0 overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <span className="font-mono text-xs text-muted-foreground">{parsed.data.host}</span>
            <span aria-hidden>/</span>
            <strong className="truncate text-sm">{parsed.data.project}</strong>
          </header>
          <main className="flex min-h-0 flex-1 items-center justify-center p-6">
            <CentralProjectUnavailable project={parsed.data} availability={availability} />
          </main>
        </SidebarInset>
      </ResizableSidebarProvider>
    )
  }
  return (
    <ResizableSidebarProvider defaultOpen={defaultOpen} className="h-svh min-h-0 overflow-hidden">
      <AppSidebar />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <AppBar project={parsed.data} />
        <WorkspaceSplitOutlet>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-8">{children}</div>
        </WorkspaceSplitOutlet>
      </SidebarInset>
      <ProjectFooter project={parsed.data} />
    </ResizableSidebarProvider>
  )
}
