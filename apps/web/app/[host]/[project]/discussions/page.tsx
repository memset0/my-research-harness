import type { Metadata } from 'next'
import { DiscussionsView } from '@/components/discussions-view'
import { type ProjectPageParams, projectFromParams } from '@/lib/server/project-page-params'
export const metadata: Metadata = { title: 'Discussions' }
export default async function Page({ params }: { params: Promise<ProjectPageParams> }) {
  return <DiscussionsView project={projectFromParams(await params)} />
}
