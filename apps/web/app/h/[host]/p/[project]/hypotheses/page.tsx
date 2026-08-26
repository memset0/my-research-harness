import { ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { HypothesisView } from '../../../../../../components/hypothesis-view'

export const metadata: Metadata = { title: 'Hypotheses' }

export default async function CentralHypothesesPage({
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
  return <HypothesisView project={target.data} />
}
