import { stat } from 'node:fs/promises'
import { BackendExperimentResponseSchema } from '@memon/core'
import { BackendProjectServiceError } from '@memon/backend'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import {
  deleteStandaloneExperiment,
  standaloneExperimentMutationError,
} from '../../../../lib/server/standalone-experiment-mutation-route'
import { standaloneExperiment } from '../../../../lib/server/standalone-dto'
import { buildExperimentDocumentView } from '../../../../lib/server/experiment-sections'
import { standaloneServices } from '../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const { id } = await params
  const cached = runtime.experiments.get(id)
  if (!cached) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: `experiment "${id}" not found` } },
      { status: 404 },
    )
  }
  const project = runtime.projectFor(cached.path)
  if (!project) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'owning project not found' } },
      { status: 404 },
    )
  }
  try {
    const portable = BackendExperimentResponseSchema.parse(
      await standaloneServices(runtime.config).projects.getExperiment(project.name, id),
    )
    const legacy = standaloneExperiment(runtime.config, portable)
    const documentView = buildExperimentDocumentView(cached, {
      runs: Object.fromEntries(
        legacy.memberRuns.map((run) => [
          run.id,
          {
            documentUrl: `/p/${encodeURIComponent(portable.project)}/e/${encodeURIComponent(portable.id)}?run=${encodeURIComponent(run.id)}`,
            wandbUrl: run.wandb,
          },
        ]),
      ),
    })
    return NextResponse.json({
      ...legacy,
      rawSections: cached.rawSections,
      documents: cached.documents,
      resultsUpdatedAt: await managedResultsUpdatedAt(cached.documents?.results),
      documentSections: documentView.sections,
      documentDiagnostics: documentView.diagnostics,
      documentReadOnly: documentView.readOnly,
    })
  } catch (error) {
    if (error instanceof BackendProjectServiceError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: error.message } },
        { status: 404 },
      )
    }
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === 'true'
  try {
    return NextResponse.json(await deleteStandaloneExperiment(runtime, id, force))
  } catch (error) {
    return (
      standaloneExperimentMutationError(error) ??
      NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
    )
  }
}

async function managedResultsUpdatedAt(
  results: { exists: boolean; path: string } | undefined,
): Promise<string | null> {
  if (!results?.exists) return null
  try {
    return (await stat(results.path)).mtime.toISOString()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
