import type { Metadata } from 'next'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { InboxShell } from '../../../../components/inbox-shell'
import { getQueryClient } from '../../../../lib/get-query-client'
import { getDigestsList } from '../../../../lib/server/data'

export const metadata: Metadata = { title: 'Digests' }

export default async function DigestsPage({
  params,
}: {
  params: Promise<{ project: string }>
}) {
  const { project } = await params
  const decoded = decodeURIComponent(project)

  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: ['digests', decoded],
    queryFn: () => getDigestsList(decoded),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InboxShell kind="digests" project={decoded} selectedId={null} />
    </HydrationBoundary>
  )
}
