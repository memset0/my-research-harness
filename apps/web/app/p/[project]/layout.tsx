import { notFound } from 'next/navigation'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { AppBar } from '../../../components/app-bar'
import { AppSidebar } from '../../../components/app-sidebar'
import { SidebarInset, SidebarProvider } from '../../../components/ui/sidebar'
import { TerminalDrawerProvider } from '../../../components/terminal-drawer-provider'
import { getQueryClient } from '../../../lib/get-query-client'
import { getRuntime } from '../../../lib/runtime'
import { getExperimentsData, getProjectsData } from '../../../lib/server/data'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ project: string }>
}) {
  const { project } = await params
  const decoded = decodeURIComponent(project)

  // Validate project exists in config; otherwise 404 instead of letting
  // downstream API calls error.
  try {
    const rt = await getRuntime()
    if (!rt.config.projects.some((p) => p.name === decoded)) notFound()
  } catch {
    notFound()
  }

  // SSR prefetch: populate ['projects'] so the sidebar renders projects in
  // the initial HTML (no "No projects configured" flash). Also prefetch
  // ['experiments', decoded] for whichever expanded project the sidebar
  // shows — most users expect the active project to be expanded.
  const queryClient = getQueryClient()
  await Promise.all([
    queryClient.prefetchQuery({ queryKey: ['projects'], queryFn: getProjectsData }),
    queryClient.prefetchQuery({
      queryKey: ['runs', decoded],
      queryFn: () => getExperimentsData(decoded),
    }),
  ])

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppBar project={decoded} />
          <TerminalDrawerProvider>
            <div className="flex-1">{children}</div>
          </TerminalDrawerProvider>
        </SidebarInset>
      </SidebarProvider>
    </HydrationBoundary>
  )
}
