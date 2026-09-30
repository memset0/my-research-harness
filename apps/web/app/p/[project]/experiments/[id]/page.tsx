import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ExperimentDetail } from '../../../../../components/experiment-detail'
import { projectQueryKey } from '../../../../../lib/api'
import { getQueryClient } from '../../../../../lib/get-query-client'
import { getExperimentData } from '../../../../../lib/server/data'

// Legacy Run detail URL, still linked from the experiment list, hypotheses
// and journal views. Every lookup is scoped to the URL's project: a Run id
// that only exists in another project is a 404 and none of its content
// (title, README, frontmatter) reaches the response.

type Params = Promise<{ project: string; id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  let rawId = ''
  try {
    const { project, id } = await params
    rawId = decodeURIComponent(id)
    const run = await getExperimentData(decodeURIComponent(project), rawId)
    if (!run) return { title: 'Not found' }
    return { title: run.id }
  } catch {
    return { title: rawId.split('-')[0] || 'Run' }
  }
}

export default async function ExperimentPage({ params }: { params: Params }) {
  const { project, id } = await params
  const decodedProject = decodeURIComponent(project)
  const decodedId = decodeURIComponent(id)

  const run = await getExperimentData(decodedProject, decodedId)
  if (!run) notFound()
  // Pre-populate the exact key ExperimentDetail reads so the client's
  // useQuery sees the data on mount without a fetch flash.
  const queryClient = getQueryClient()
  queryClient.setQueryData(['run', ...projectQueryKey(decodedProject), decodedId], run)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ExperimentDetail project={decodedProject} id={decodedId} />
    </HydrationBoundary>
  )
}
