import { notFound } from 'next/navigation'
import { AppBar } from '../../../components/app-bar'
import { AppSidebar } from '../../../components/app-sidebar'
import { SidebarInset, SidebarProvider } from '../../../components/ui/sidebar'
import { getRuntime } from '../../../lib/runtime'

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

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppBar project={decoded} />
        <div className="flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
