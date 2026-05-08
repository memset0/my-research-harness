// Layout for top-level cross-project management pages under `/manage/*`.
// Mirrors the project layout's sidebar wrapping but does NOT mount
// `<AppBar>` (that's project-scoped). The active-highlight on the
// sidebar's `Manage tmux` footer link surfaces here automatically
// because `<AppSidebar>` is now in the tree.

import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { AppSidebar } from '../../components/app-sidebar'
import { SidebarInset, SidebarProvider } from '../../components/ui/sidebar'
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

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <div className="flex-1">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </HydrationBoundary>
  )
}
