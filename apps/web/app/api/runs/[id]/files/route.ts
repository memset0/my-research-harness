import { BackendProjectServiceError } from '@memon/backend'
import {
  BackendRunFilesResponseSchema,
  type BackendRunFileTreeNode,
  ProjectNameSchema,
} from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { RunFilesResponse } from '@/lib/dto/runs'
import { getRuntime } from '../../../../../lib/server/runtime'
import { standaloneServices } from '../../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'
const DEFAULT_DEPTH = 3

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const current = runtime.index.get(id)
  if (!current || current.project !== project.data) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: `run "${id}" not found` } },
      { status: 404 },
    )
  }
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
      runPath: current.path,
      tree: legacyFileTree(portable.tree),
    } satisfies RunFilesResponse)
  } catch (error) {
    if (error instanceof BackendProjectServiceError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'run files not found' } },
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
