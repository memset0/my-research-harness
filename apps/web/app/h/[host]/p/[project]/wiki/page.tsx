import { ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { WikiShell } from '../../../../../../components/wiki-shell'

export const metadata: Metadata = { title: 'Wiki' }

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
  return <WikiShell project={target.data} selectedId={null} />
}
