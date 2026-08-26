import { ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { InboxShell } from '../../../../../../components/inbox-shell'

export const metadata: Metadata = { title: 'Reports' }

export default async function Page({
  params,
}: {
  params: Promise<{ host: string; project: string }>
}) {
  const p = await params
  const target = ProjectRefSchema.safeParse({
    host: decodeURIComponent(p.host),
    project: decodeURIComponent(p.project),
  })
  if (!target.success) notFound()
  return <InboxShell kind="reports" project={target.data} selectedId={null} />
}
