import type { Metadata } from 'next'
import { InboxShell } from '@/components/inbox-shell'
import { type ProjectPageParams, projectFromParams } from '@/lib/server/project-page-params'

export const metadata: Metadata = { title: 'Reports' }

export default async function ReportsPage({ params }: { params: Promise<ProjectPageParams> }) {
  return <InboxShell kind="reports" project={projectFromParams(await params)} selectedId={null} />
}
