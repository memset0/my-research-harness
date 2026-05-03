import { notFound } from 'next/navigation'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { ExperimentDetail } from '../../../../../components/experiment-detail'
import { getQueryClient } from '../../../../../lib/get-query-client'
import { getExperimentData } from '../../../../../lib/server/data'

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ project: string; id: string }>
}) {
  const { project, id } = await params
  const decodedProject = decodeURIComponent(project)
  const decodedId = decodeURIComponent(id)

  const queryClient = getQueryClient()
  const exp = await getExperimentData(decodedId)
  if (!exp) notFound()
  // Pre-populate the query cache so the client's useQuery sees the data
  // immediately on mount, no fetch flash
  queryClient.setQueryData(['experiment', decodedId], exp)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ExperimentDetail project={decodedProject} id={decodedId} />
    </HydrationBoundary>
  )
}
