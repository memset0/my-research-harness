import { ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { InboxShell } from '../../../../../../../components/inbox-shell'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  try {
    return { title: `${decodeURIComponent((await params).id)} · Reports` }
  } catch {
    return { title: 'Reports' }
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ host: string; project: string; id: string }>
}) {
  const p = await params
  const target = ProjectRefSchema.safeParse({
    host: decodeURIComponent(p.host),
    project: decodeURIComponent(p.project),
  })
  if (!target.success) notFound()
  return <InboxShell kind="reports" project={target.data} selectedId={decodeURIComponent(p.id)} />
}
