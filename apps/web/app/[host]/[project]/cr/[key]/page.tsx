import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CodeReviewDetail } from '@/components/code-review-detail'
import { type ProjectPageParams, projectFromParams } from '@/lib/server/project-page-params'
import { reviewKeyFromParam } from '@/lib/server/review-key'

type Params = ProjectPageParams & { key: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const key = reviewKeyFromParam((await params).key)
  return { title: key ? `${key} · Code review` : 'Code review' }
}

export default async function ProjectCodeReviewPage({ params }: { params: Promise<Params> }) {
  const input = await params
  const project = projectFromParams(input)
  const key = reviewKeyFromParam(input.key)
  if (!key) notFound()
  return <CodeReviewDetail project={project} id={`code-review/${key}`} />
}
