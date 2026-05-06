import { ExperimentCardGrid } from '../../../components/experiment-card-grid'

export default async function ProjectListPage({
  params,
}: {
  params: Promise<{ project: string }>
}) {
  const { project } = await params
  return <ExperimentCardGrid project={decodeURIComponent(project)} />
}
