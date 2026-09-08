import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { redirect } from 'next/navigation'
import { AppBar } from '../../../components/app-bar'
import { AppSidebar } from '../../../components/app-sidebar'
import { ProjectFooter } from '../../../components/project-footer'
import { ResizableSidebarProvider } from '../../../components/resizable-sidebar-provider'
import { WorkspaceSplitOutlet } from '../../../components/workspace-pane-provider'
import { SidebarInset } from '../../../components/ui/sidebar'
import { getQueryClient } from '../../../lib/get-query-client'
import { getRuntime } from '../../../lib/runtime'
import { readIdentityFromHeaders } from '../../../lib/auth/request-context'
import { aggregateCentralProjects } from '../../../lib/central/central-projects'
import { getCentralFleet } from '../../../lib/central/fleet-runtime'
import { resolveLegacyProject } from '../../../lib/central/legacy-project'
import { getProjectsData } from '../../../lib/server/data'

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
  const rt = await getRuntime().catch(() => null)
  if (!rt) notFound()
  if (rt.config.central) {
    const identity = await readIdentityFromHeaders()
    if (identity.role === 'anon') notFound()
    const fleet = await getCentralFleet()
    const payload = await aggregateCentralProjects({
      registry: fleet.registry,
      actor:
        identity.role === 'viewer'
          ? { role: 'viewer', scopes: identity.scopeProjectRefs }
          : { role: 'owner' },
    })
    const resolution = resolveLegacyProject(decoded, payload.projects)
    if (resolution.kind === 'unique') {
      redirect(
        `/h/${encodeURIComponent(resolution.project.host)}/p/${encodeURIComponent(resolution.project.project)}`,
      )
    }
    if (resolution.kind === 'ambiguous') {
      return (
        <main className="mx-auto flex max-w-lg flex-col gap-3 p-6">
          <h1 className="text-lg font-semibold">Choose a Host</h1>
          <p className="text-sm text-muted-foreground">
            Project <code>{decoded}</code> exists on more than one Host.
          </p>
          <ul className="flex flex-col gap-2">
            {resolution.projects.map((project) => (
              <li key={project.host}>
                <a
                  className="text-sm underline"
                  href={`/h/${encodeURIComponent(project.host)}/p/${encodeURIComponent(project.project)}`}
                >
                  {project.host}/{project.project}
                </a>
              </li>
            ))}
          </ul>
        </main>
      )
    }
    notFound()
  }
  if (!rt.config.projects.some((p) => p.name === decoded)) notFound()

  // SSR prefetch: populate ['projects'] so the sidebar renders projects in
  // the initial HTML (no "No projects configured" flash). Nothing here
  // prefetches the Run index: no mounted shell surface reads it, and doing
  // so would walk every Run folder on each project page render.
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({ queryKey: ['projects'], queryFn: getProjectsData })

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
      <ResizableSidebarProvider defaultOpen={defaultOpen} className="h-svh min-h-0 overflow-hidden">
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
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <AppBar project={decoded} />
          {/* `pb-8` clears the fixed project footer (~28px) so the last
              row of content isn't occluded. `min-w-0` propagates the
              shrinkability one level deeper so the children block keeps
              the same constraint. */}
          <WorkspaceSplitOutlet>
            <div className="min-h-0 min-w-0 flex-1 pb-8">{children}</div>
          </WorkspaceSplitOutlet>
        </SidebarInset>
        <ProjectFooter project={decoded} />
      </ResizableSidebarProvider>
    </HydrationBoundary>
  )
}
