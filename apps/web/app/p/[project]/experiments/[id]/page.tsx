import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { ExperimentDetail } from '../../../../../components/experiment-detail'
import { getQueryClient } from '../../../../../lib/get-query-client'
import { getExperimentData } from '../../../../../lib/server/data'
import { getRuntime } from '../../../../../lib/runtime'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  let rawId = ''
  try {
    const { id } = await params
    rawId = decodeURIComponent(id)
    const rt = await getRuntime()
    const exp = rt.experiments.get(rawId)
    if (exp) {
      const eNumber = exp.id.split('-')[0]
      const slug = exp.frontMatter.slug
      return { title: slug ? `${eNumber} ${slug}` : eNumber }
    }
    return { title: rawId.split('-')[0] }
  } catch {
    return { title: rawId.split('-')[0] || 'Experiment' }
  }
}

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
