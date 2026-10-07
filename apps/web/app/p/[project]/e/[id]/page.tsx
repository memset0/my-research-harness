import { BackendExperimentResponseSchema } from '@memon/core'
import type { Metadata } from 'next'
import { ExperimentPage } from '../../../../../components/experiment-page'
import { getRuntime } from '../../../../../lib/server/runtime'
import { standaloneServices } from '../../../../../lib/server/standalone-services'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; id: string }>
}): Promise<Metadata> {
  let rawId = ''
  try {
    const { project, id } = await params
    rawId = decodeURIComponent(id)
    const rt = await getRuntime()
    const exp = BackendExperimentResponseSchema.parse(
      await standaloneServices(rt.config).projects.getExperiment(
        decodeURIComponent(project),
        rawId,
      ),
    )
    if (exp) {
      const eNumber = exp.id.split('-')[0]
      const slug = exp.frontMatter.slug
      return { title: slug ? `${eNumber} ${slug}` : eNumber }
    }
    return { title: rawId.split('-')[0] }
  } catch {
    return { title: rawId.split('-')[0] || 'Experiment' }
  }
}

export default async function ExperimentDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; id: string }>
  searchParams: Promise<{ run?: string }>
}) {
  const { project, id } = await params
  const sp = await searchParams
  return (
    <ExperimentPage
      project={decodeURIComponent(project)}
      experimentId={decodeURIComponent(id)}
      initialOpenRun={sp.run ? decodeURIComponent(sp.run) : null}
    />
  )
}
