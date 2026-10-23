import { ExperimentCardGrid } from '@/components/experiment-card-grid'
import { type ProjectPageParams, projectFromParams } from '@/lib/server/project-page-params'

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<ProjectPageParams>
}) {
  return <ExperimentCardGrid project={projectFromParams(await params)} />
}
