import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { HypothesisView } from '../../../../components/hypothesis-view'
import { getQueryClient } from '../../../../lib/get-query-client'
import { getHypothesesData } from '../../../../lib/server/data'

export const metadata: Metadata = { title: 'Hypotheses' }

export default async function HypothesesPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params
  const decoded = decodeURIComponent(project)

  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: ['hypotheses', decoded],
    queryFn: () => getHypothesesData(decoded),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HypothesisView project={decoded} />
    </HydrationBoundary>
  )
}
