import { ExperimentList } from '../../../components/experiment-list'

export default async function ProjectExperimentsPage({
  params,
}: {
  params: Promise<{ project: string }>
}) {
  const { project } = await params
  return <ExperimentList project={decodeURIComponent(project)} />
}
