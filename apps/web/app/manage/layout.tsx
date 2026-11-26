// Layout for top-level cross-project management pages under `/manage/*`.
// Mirrors the project layout's sidebar wrapping but does not mount the
// project-scoped AppBar.

import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { cookies } from 'next/headers'
import { AdminNav } from '../../components/admin-nav'
import { AppSidebar } from '../../components/app-sidebar'
import { ResizableSidebarProvider } from '../../components/resizable-sidebar-provider'
import { SidebarInset, SidebarTrigger } from '../../components/ui/sidebar'
import { getQueryClient } from '../../lib/get-query-client'
import { queryKeys } from '../../lib/query-keys'
import { adminSectionsFor } from '../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../lib/server/auth/request-context'
import { getProjectsData } from '../../lib/server/data'

export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  // SSR-prefetch the project list so the sidebar's project tree renders
  // in the initial HTML (no "No projects configured" flash on first paint).
  const queryClient = getQueryClient()

  // Match `/[host]/[project]/layout.tsx`: read `sidebar_state` so the collapse
  // state survives navigation across the project / manage boundary.
  const cookieStore = await cookies()
  const sidebarStateCookie = cookieStore.get('sidebar_state')?.value
  const defaultOpen = sidebarStateCookie !== 'false'
  const account = await readAccountFromHeaders()
  // The unfiltered list is the super admin's; other accounts fetch their scoped one.
  if (account?.level === 'super_admin')
    await queryClient.prefetchQuery({ queryKey: queryKeys.projects(), queryFn: getProjectsData })
  const sections = adminSectionsFor(account?.level).map(({ key, label, href }) => ({
    key,
    label,
    href,
  }))

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ResizableSidebarProvider defaultOpen={defaultOpen} className="h-svh overflow-hidden">
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
            <span className="text-xs font-medium text-muted-foreground">Admin</span>
            <AdminNav sections={sections} />
          </header>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
          </div>
        </SidebarInset>
      </ResizableSidebarProvider>
    </HydrationBoundary>
  )
}
