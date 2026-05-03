import { ExperimentDetail } from '../../../../../components/experiment-detail'

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ project: string; id: string }>
}) {
  const { project, id } = await params
  return <ExperimentDetail project={decodeURIComponent(project)} id={decodeURIComponent(id)} />
}
