import type { Metadata } from 'next'
import { WikiShell } from '@/components/wiki-shell'
import { type ProjectPageParams, projectFromParams } from '@/lib/server/project-page-params'

export const metadata: Metadata = { title: 'Wiki' }

export default async function WikiListPage({ params }: { params: Promise<ProjectPageParams> }) {
  return <WikiShell project={projectFromParams(await params)} selectedId={null} />
}
