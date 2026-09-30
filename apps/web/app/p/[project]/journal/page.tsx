import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { JournalView } from '../../../../components/journal-view'
import { getQueryClient } from '../../../../lib/get-query-client'
import { getJournalData } from '../../../../lib/server/data'

export const metadata: Metadata = { title: 'Journal' }

export default async function JournalPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params
  const decoded = decodeURIComponent(project)

  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: ['journal', decoded],
    queryFn: () => getJournalData(decoded, { limit: 200 }),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <JournalView project={decoded} />
    </HydrationBoundary>
  )
}
