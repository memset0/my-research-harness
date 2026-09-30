import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { CodeReviewList } from '../../../../components/code-review-list'
import { getQueryClient } from '../../../../lib/get-query-client'
import { getCodeReviewsList } from '../../../../lib/server/data'

export const metadata: Metadata = { title: 'Code review' }

export default async function CodeReviewPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params
  const decoded = decodeURIComponent(project)

  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: ['code-reviews', decoded],
    queryFn: () => getCodeReviewsList(decoded),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CodeReviewList project={decoded} />
    </HydrationBoundary>
  )
}
