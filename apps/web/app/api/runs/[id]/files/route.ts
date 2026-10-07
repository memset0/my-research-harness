import { BackendProjectServiceError, withRequestScope } from '@memon/backend'
import {
  BackendRunFilesResponseSchema,
  type BackendRunFileTreeNode,
  ProjectNameSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { RunFilesResponse } from '@/lib/dto/runs'
import { withValidRunId } from '../../../../../lib/server/run-id'
import { getRuntime } from '../../../../../lib/server/runtime'
import { withStandaloneRequest } from '../../../../../lib/server/standalone-request'
import { standaloneServices } from '../../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'
const DEFAULT_DEPTH = 3

async function handleGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const { id } = await params
  const url = new URL(req.url)
  const projects = url.searchParams.getAll('project')
  const project = projects.length === 1 ? ProjectNameSchema.safeParse(projects[0]) : null
  if (!project?.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'exactly one project selector is required' } },
      { status: 400 },
    )
  }
  const depthValue = url.searchParams.get('depth')
  if (depthValue !== null && !/^[1-6]$/.test(depthValue)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'depth must be an integer from 1 to 6' } },
      { status: 400 },
    )
  }
  // The Run is resolved by path (or unique directory name) through the
  // Project's own resolver; a legacy in-memory index is empty when central
  // serves the Project directly, so it must not gate this read.
  try {
    const portable = BackendRunFilesResponseSchema.parse(
      await standaloneServices(runtime.config).projects.getRunFiles(
        project.data,
        id,
        depthValue === null ? DEFAULT_DEPTH : Number(depthValue),
      ),
    )
    return NextResponse.json({
      ...portable,
      tree: legacyFileTree(portable.tree),
    } satisfies RunFilesResponse)
  } catch (error) {
    if (error instanceof BackendProjectServiceError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `run "${id}" not found` } },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: { code: 'FILES_READ_FAILED', message: 'run files could not be read' } },
      { status: 500 },
    )
  }
}

function legacyFileTree(node: BackendRunFileTreeNode): BackendRunFileTreeNode & { path: string } {
  return {
    ...node,
    path: node.resource,
    ...(node.children ? { children: node.children.map(legacyFileTree) } : {}),
  }
}

// One request scope: the Project root's real path is resolved once.
const scopedGET = withValidRunId(
  (request: Parameters<typeof handleGET>[0], context: Parameters<typeof handleGET>[1]) =>
    withRequestScope(() => handleGET(request, context)),
)

export const GET = withStandaloneRequest(scopedGET)
