import { notFound } from 'next/navigation'
import { Header } from '../../../components/header'
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

  // Validate project exists in config; otherwise render 404 instead of
  // letting downstream API calls error out.
  try {
    const rt = await getRuntime()
    if (!rt.config.projects.some((p) => p.name === decoded)) notFound()
  } catch {
    // If the runtime itself can't initialize, let the home page handle the
    // friendly error; here we just propagate as 404.
    notFound()
  }

  return (
    <>
      <Header project={decoded} />
      {children}
    </>
  )
}
