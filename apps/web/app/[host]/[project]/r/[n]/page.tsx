import type { Metadata } from 'next'
import { InboxShell } from '@/components/inbox-shell'
import { artifactIdPrefix } from '@/lib/project-routes'
import {
  canonicalNumber,
  numberFromParam,
  type ProjectPageParams,
  projectFromParams,
} from '@/lib/server/project-page-params'

type Params = ProjectPageParams & { n: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const number = canonicalNumber((await params).n)
  return { title: number === null ? 'Reports' : `${artifactIdPrefix('R', number)} · Reports` }
}

export default async function ReportPage({ params }: { params: Promise<Params> }) {
  const input = await params
  const project = projectFromParams(input)
  const id = artifactIdPrefix('R', numberFromParam(input.n))
  return <InboxShell kind="reports" project={project} selectedId={id} />
}
