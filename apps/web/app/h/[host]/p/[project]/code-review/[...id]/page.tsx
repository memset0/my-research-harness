import { ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CodeReviewDetail } from '../../../../../../../components/code-review-detail'

const CR_ID_RE =
  /^(code-review|experiments\/E\d{4}-[a-z0-9-]+\/code-review)\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string[] }>
}): Promise<Metadata> {
  try {
    const { id } = await params
    const last = id.at(-1) ?? 'Code review'
    return { title: `${decodeURIComponent(last)} · Code review` }
  } catch {
    return { title: 'Code review' }
  }
}

export default async function CentralCodeReviewDetailPage({
  params,
}: {
  params: Promise<{ host: string; project: string; id: string[] }>
}) {
  const input = await params
  const target = ProjectRefSchema.safeParse({
    host: decodeURIComponent(input.host),
    project: decodeURIComponent(input.project),
  })
  const id = input.id.map(decodeURIComponent).join('/')
  if (!target.success || !CR_ID_RE.test(id)) notFound()
  return <CodeReviewDetail project={target.data} id={id} />
}
