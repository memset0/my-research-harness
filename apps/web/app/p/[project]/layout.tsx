import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { AppBar } from '../../../components/app-bar'
import { AppSidebar } from '../../../components/app-sidebar'
import { ProjectFooter } from '../../../components/project-footer'
import { ResizableSidebarProvider } from '../../../components/resizable-sidebar-provider'
import { SidebarInset } from '../../../components/ui/sidebar'
import { getQueryClient } from '../../../lib/get-query-client'
import { getRuntime } from '../../../lib/runtime'
import { getExperimentsData, getProjectsData } from '../../../lib/server/data'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string }>
}): Promise<Metadata> {
  try {
    const { project } = await params
    const decoded = decodeURIComponent(project)
    return {
      title: {
        default: decoded,
        template: `%s · ${decoded} · memon`,
      },
    }
  } catch {
    return {}
  }
}

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

  // shadcn pattern: read the `sidebar_state` cookie on the server so the
  // initial SSR HTML renders in the user's persisted open/collapsed state
  // without a hydration flicker. The cookie is written by setOpen() in
  // `ui/sidebar.tsx` whenever the user clicks the trigger.
  const cookieStore = await cookies()
  const sidebarStateCookie = cookieStore.get('sidebar_state')?.value
  // The cookie is the literal string "true" or "false"; treat any other
  // value (or absence) as the default "open".
  const defaultOpen = sidebarStateCookie !== 'false'

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ResizableSidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar />
        {/*
          `min-w-0` is critical: SidebarInset is a flex item whose default
          `min-width: auto` would let a wide child (a log viewer, a wide
          experiments grid, a table) push the inset past its flex-share
          and out beyond the viewport's right edge — symptom: "drawer
          expanded, page > 100% wide, right-side content runs off the
          page". `min-w-0` lets the inset shrink below its content's
          intrinsic min-width so wide children scroll inside their own
          containers instead of expanding the layout.
        */}
        <SidebarInset className="min-w-0">
          <AppBar project={decoded} />
          {/* `pb-8` clears the fixed project footer (~28px) so the last
              row of content isn't occluded. `min-w-0` propagates the
              shrinkability one level deeper so the children block keeps
              the same constraint. */}
          <div className="min-w-0 flex-1 pb-8">{children}</div>
        </SidebarInset>
        <ProjectFooter project={decoded} />
      </ResizableSidebarProvider>
    </HydrationBoundary>
  )
}
