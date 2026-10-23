import type { Metadata } from 'next'
import { CodeReviewList } from '@/components/code-review-list'
import { type ProjectPageParams, projectFromParams } from '@/lib/server/project-page-params'

export const metadata: Metadata = { title: 'Code review' }

export default async function CodeReviewsPage({ params }: { params: Promise<ProjectPageParams> }) {
  return <CodeReviewList project={projectFromParams(await params)} />
}
