import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  DuplicateExperimentNumber,
  ExperimentCatalogUnavailable,
} from '@/components/duplicate-experiment-number'
import { ExperimentPage } from '@/components/experiment-page'
import { artifactIdPrefix } from '@/lib/project-routes'
import { resolveExperimentNumber } from '@/lib/server/experiment-number'
import {
  canonicalNumber,
  numberFromParam,
  type ProjectPageParams,
  projectFromParams,
} from '@/lib/server/project-page-params'

type Params = ProjectPageParams & { n: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const number = canonicalNumber((await params).n)
  return { title: number === null ? 'Experiment' : artifactIdPrefix('E', number) }
}

export default async function ExperimentNumberPage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<{ run?: string }>
}) {
  const input = await params
  const project = projectFromParams(input)
  const number = numberFromParam(input.n)
  const resolution = await resolveExperimentNumber(project, number)
  if (resolution.kind === 'missing') notFound()
  if (resolution.kind === 'duplicate')
    return <DuplicateExperimentNumber number={number} ids={resolution.ids} />
  if (resolution.kind === 'unavailable') return <ExperimentCatalogUnavailable number={number} />
  const { run } = await searchParams
  return (
    <ExperimentPage project={project} experimentId={resolution.id} initialOpenRun={run ?? null} />
  )
}
