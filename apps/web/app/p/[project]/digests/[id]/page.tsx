import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { InboxShell } from '../../../../../components/inbox-shell'
import { getQueryClient } from '../../../../../lib/get-query-client'
import { getDigest, getDigestsList } from '../../../../../lib/server/data'

const ID_REGEX = /^D\d{4}$/

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; id: string }>
}): Promise<Metadata> {
  try {
    const { id } = await params
    return { title: `${decodeURIComponent(id)} · Digests` }
  } catch {
    return { title: 'Digests' }
  }
}

export default async function DigestDetailPage({
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
      queryKey: ['digests', decodedProject],
      queryFn: () => getDigestsList(decodedProject),
    }),
    queryClient.prefetchQuery({
      queryKey: ['digest', decodedProject, decodedId],
      queryFn: () => getDigest(decodedProject, decodedId),
    }),
  ])

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InboxShell kind="digests" project={decodedProject} selectedId={decodedId} />
    </HydrationBoundary>
  )
}
