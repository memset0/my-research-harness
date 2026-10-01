import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { WikiShell } from '../../../../components/wiki-shell'
import { getQueryClient } from '../../../../lib/get-query-client'
import { queryKeys } from '../../../../lib/query-keys'
import { getWikiList } from '../../../../lib/server/data'

export const metadata: Metadata = { title: 'Wiki' }

export default async function WikiPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params
  const decoded = decodeURIComponent(project)

  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: queryKeys.wiki(decoded),
    queryFn: () => getWikiList(decoded),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WikiShell project={decoded} selectedId={null} />
    </HydrationBoundary>
  )
}
