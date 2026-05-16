// Layout for top-level cross-project management pages under `/manage/*`.
// Mirrors the project layout's sidebar wrapping but does NOT mount
// `<AppBar>` (that's project-scoped). The active-highlight on the
// sidebar's `Manage tmux` footer link surfaces here automatically
// because `<AppSidebar>` is now in the tree.

import { cookies } from 'next/headers'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { AppSidebar } from '../../components/app-sidebar'
import { ResizableSidebarProvider } from '../../components/resizable-sidebar-provider'
import { SidebarInset, SidebarTrigger } from '../../components/ui/sidebar'
import { getQueryClient } from '../../lib/get-query-client'
import { getProjectsData } from '../../lib/server/data'

export default async function ManageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // SSR-prefetch the project list so the sidebar's project tree renders
  // in the initial HTML (no "No projects configured" flash on first paint).
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({ queryKey: ['projects'], queryFn: getProjectsData })

  // Match `/p/[project]/layout.tsx`: read `sidebar_state` so the collapse
  // state survives navigation across the project / manage boundary.
  const cookieStore = await cookies()
  const sidebarStateCookie = cookieStore.get('sidebar_state')?.value
  const defaultOpen = sidebarStateCookie !== 'false'

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ResizableSidebarProvider
        defaultOpen={defaultOpen}
        className="h-svh overflow-hidden"
      >
        <AppSidebar />
        <SidebarInset className="min-h-0 overflow-hidden">
          {/* Manage pages deliberately do NOT mount <AppBar> (it's
              project-scoped). This minimal strip restores the
              visible SidebarTrigger so desktop users have a click
              affordance to collapse/expand the drawer; keyboard
              shortcut (Cmd/Ctrl+B) and mobile offcanvas already
              work via shadcn's SidebarProvider. */}
          <header className="flex h-12 items-center gap-2 border-b border-border bg-background px-3">
            <SidebarTrigger />
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </SidebarInset>
      </ResizableSidebarProvider>
    </HydrationBoundary>
  )
}
