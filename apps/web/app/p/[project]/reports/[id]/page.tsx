import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { InboxShell } from '../../../../../components/inbox-shell'
import { getQueryClient } from '../../../../../lib/get-query-client'
import { getReport, getReportsList } from '../../../../../lib/server/data'

const ID_REGEX = /^R\d{4}$/

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; id: string }>
}): Promise<Metadata> {
  try {
    const { id } = await params
    return { title: `${decodeURIComponent(id)} · Reports` }
  } catch {
    return { title: 'Reports' }
  }
}

export default async function ReportDetailPage({
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
      queryKey: ['reports', decodedProject],
      queryFn: () => getReportsList(decodedProject),
    }),
    queryClient.prefetchQuery({
      queryKey: ['report', decodedProject, decodedId],
      queryFn: () => getReport(decodedProject, decodedId),
    }),
  ])

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InboxShell kind="reports" project={decodedProject} selectedId={decodedId} />
    </HydrationBoundary>
  )
}
