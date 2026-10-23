import type { Metadata } from 'next'
import { JournalView } from '@/components/journal-view'
import { type ProjectPageParams, projectFromParams } from '@/lib/server/project-page-params'

export const metadata: Metadata = { title: 'Journal' }

export default async function JournalPage({ params }: { params: Promise<ProjectPageParams> }) {
  return <JournalView project={projectFromParams(await params)} />
}
