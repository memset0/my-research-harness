import { ProjectRefSchema } from '@memon/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { WikiShell } from '../../../../../../../components/wiki-shell'

const ID_REGEX = /^W\d{4}$/

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  try {
    return { title: `${decodeURIComponent((await params).id)} · Wiki` }
  } catch {
    return { title: 'Wiki' }
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
  const decodedId = decodeURIComponent(p.id)
  if (!ID_REGEX.test(decodedId)) notFound()
  return <WikiShell project={target.data} selectedId={decodedId} />
}
