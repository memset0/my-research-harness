import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { InboxShell } from '../../../../components/inbox-shell'
import { getQueryClient } from '../../../../lib/get-query-client'
import { getReportsList } from '../../../../lib/server/data'

export const metadata: Metadata = { title: 'Reports' }

export default async function ReportsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params
  const decoded = decodeURIComponent(project)

  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: ['reports', decoded],
    queryFn: () => getReportsList(decoded),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InboxShell kind="reports" project={decoded} selectedId={null} />
    </HydrationBoundary>
  )
}
