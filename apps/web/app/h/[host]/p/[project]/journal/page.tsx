import { ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { JournalView } from '../../../../../../components/journal-view'

export const metadata: Metadata = { title: 'Journal' }

export default async function CentralJournalPage({
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
  return <JournalView project={target.data} />
}
