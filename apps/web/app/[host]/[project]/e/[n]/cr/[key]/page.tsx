import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CodeReviewDetail } from '@/components/code-review-detail'
import {
  DuplicateExperimentNumber,
  ExperimentCatalogUnavailable,
} from '@/components/duplicate-experiment-number'
import { resolveExperimentNumber } from '@/lib/server/experiment-number'
import {
  numberFromParam,
  type ProjectPageParams,
  projectFromParams,
} from '@/lib/server/project-page-params'
import { reviewKeyFromParam } from '@/lib/server/review-key'

type Params = ProjectPageParams & { n: string; key: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const key = reviewKeyFromParam((await params).key)
  return { title: key ? `${key} · Code review` : 'Code review' }
}

export default async function ExperimentCodeReviewPage({ params }: { params: Promise<Params> }) {
  const input = await params
  const project = projectFromParams(input)
  const number = numberFromParam(input.n)
  const key = reviewKeyFromParam(input.key)
  if (!key) notFound()
  const resolution = await resolveExperimentNumber(project, number)
  if (resolution.kind === 'missing') notFound()
  if (resolution.kind === 'duplicate')
    return <DuplicateExperimentNumber number={number} ids={resolution.ids} />
  if (resolution.kind === 'unavailable') return <ExperimentCatalogUnavailable number={number} />
  return (
    <CodeReviewDetail project={project} id={`experiments/${resolution.id}/code-review/${key}`} />
  )
}
