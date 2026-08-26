import { ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ExperimentPage } from '../../../../../../../components/experiment-page'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string; project: string; id: string }>
}): Promise<Metadata> {
  const { id } = await params
  return {
    title: decodeURIComponent(id).split('-')[0],
  }
}

export default async function HostExperimentDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ host: string; project: string; id: string }>
  searchParams: Promise<{ run?: string }>
}) {
  const { host, project, id } = await params
  const sp = await searchParams
  const target = ProjectRefSchema.safeParse({
    host: decodeURIComponent(host),
    project: decodeURIComponent(project),
  })
  if (!target.success) notFound()
  return (
    <ExperimentPage
      project={target.data}
      experimentId={decodeURIComponent(id)}
      initialOpenRun={sp.run ? decodeURIComponent(sp.run) : null}
    />
  )
}
