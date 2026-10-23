import type { Metadata } from 'next'
import { WikiShell } from '@/components/wiki-shell'
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
  return { title: number === null ? 'Wiki' : `${artifactIdPrefix('W', number)} · Wiki` }
}

export default async function WikiPage({ params }: { params: Promise<Params> }) {
  const input = await params
  const project = projectFromParams(input)
  const id = artifactIdPrefix('W', numberFromParam(input.n))
  return <WikiShell project={project} selectedId={id} />
}
