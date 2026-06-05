import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { CodeReviewDetail } from '../../../../../components/code-review-detail'
import { getQueryClient } from '../../../../../lib/get-query-client'
import { getCodeReview, getCodeReviewsList } from '../../../../../lib/server/data'

// Project-wide: code-review/<date>-<slug>
// Experiment:   experiments/E<NNNN>-<slug>/code-review/<date>-<slug>
const CR_ID_RE =
  /^(code-review|experiments\/E\d{4}-[a-z0-9-]+\/code-review)\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; id: string[] }>
}): Promise<Metadata> {
  try {
    const { id } = await params
    const last = id[id.length - 1] ?? 'Code review'
    return { title: `${decodeURIComponent(last)} · Code review` }
  } catch {
    return { title: 'Code review' }
  }
}

export default async function CodeReviewDetailPage({
  params,
}: {
  params: Promise<{ project: string; id: string[] }>
}) {
  const { project, id } = await params
  const decodedProject = decodeURIComponent(project)
  const decodedId = id.map(decodeURIComponent).join('/')
  if (!CR_ID_RE.test(decodedId)) notFound()

  const queryClient = getQueryClient()
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['code-reviews', decodedProject],
      queryFn: () => getCodeReviewsList(decodedProject),
    }),
    queryClient.prefetchQuery({
      queryKey: ['code-review', decodedProject, decodedId],
      queryFn: () => getCodeReview(decodedProject, decodedId),
    }),
  ])

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CodeReviewDetail project={decodedProject} id={decodedId} />
    </HydrationBoundary>
  )
}
