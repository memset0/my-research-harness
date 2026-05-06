import { ExperimentPage } from '../../../../../components/experiment-page'

export default async function ExperimentDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; id: string }>
  searchParams: Promise<{ run?: string }>
}) {
  const { project, id } = await params
  const sp = await searchParams
  return (
    <ExperimentPage
      project={decodeURIComponent(project)}
      experimentId={decodeURIComponent(id)}
      initialOpenRun={sp.run ? decodeURIComponent(sp.run) : null}
    />
  )
}
