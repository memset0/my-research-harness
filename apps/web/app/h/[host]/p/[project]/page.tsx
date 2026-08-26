import { notFound } from 'next/navigation'
import { ProjectRefSchema } from '@memon/core'
import { ExperimentCardGrid } from '../../../../../components/experiment-card-grid'

export default async function CentralProjectPage({
  params,
}: {
  params: Promise<{ host: string; project: string }>
}) {
  const raw = await params
  const project = ProjectRefSchema.safeParse({
    host: decodeURIComponent(raw.host),
    project: decodeURIComponent(raw.project),
  })
  if (!project.success) notFound()
  return <ExperimentCardGrid project={project.data} />
}
