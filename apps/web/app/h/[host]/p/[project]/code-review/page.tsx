import { ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CodeReviewList } from '../../../../../../components/code-review-list'

export const metadata: Metadata = { title: 'Code review' }

export default async function CentralCodeReviewPage({
  params,
}: {
  params: Promise<{ host: string; project: string }>
}) {
  const input = await params
  const target = ProjectRefSchema.safeParse({
    host: decodeURIComponent(input.host),
    project: decodeURIComponent(input.project),
  })
  if (!target.success) notFound()
  return <CodeReviewList project={target.data} />
}
