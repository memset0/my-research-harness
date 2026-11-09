import type { Metadata } from 'next'
import { DiscussionsView } from '@/components/discussions-view'
import { numberFromParam, projectFromParams } from '@/lib/server/project-page-params'
export const metadata: Metadata = { title: 'Discussion' }
export default async function Page({
  params,
}: {
  params: Promise<{ host: string; project: string; n: string }>
}) {
  const p = await params
  return (
    <DiscussionsView
      project={projectFromParams(p)}
      id={`D${String(numberFromParam(p.n)).padStart(4, '0')}`}
    />
  )
}
