import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { WikiShell } from '../../../../../components/wiki-shell'
import { getQueryClient } from '../../../../../lib/get-query-client'
import { getWikiList, getWikiPage } from '../../../../../lib/server/data'

const ID_REGEX = /^W\d{4}$/

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; id: string }>
}): Promise<Metadata> {
  try {
    const { id } = await params
    return { title: `${decodeURIComponent(id)} · Wiki` }
  } catch {
    return { title: 'Wiki' }
  }
}

export default async function WikiDetailPage({
  params,
}: {
  params: Promise<{ project: string; id: string }>
}) {
  const { project, id } = await params
  const decodedProject = decodeURIComponent(project)
  const decodedId = decodeURIComponent(id)
  if (!ID_REGEX.test(decodedId)) notFound()

  const queryClient = getQueryClient()
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['wiki', decodedProject],
      queryFn: () => getWikiList(decodedProject),
    }),
    queryClient.prefetchQuery({
      queryKey: ['wiki-page', decodedProject, decodedId],
      queryFn: () => getWikiPage(decodedProject, decodedId),
    }),
  ])

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WikiShell project={decodedProject} selectedId={decodedId} />
    </HydrationBoundary>
  )
}
