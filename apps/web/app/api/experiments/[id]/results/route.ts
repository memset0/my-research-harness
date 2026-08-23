import { readFile, stat } from 'node:fs/promises'
import { parseResultsYaml } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const runtime = await getRuntime()
    const experiment = runtime.experiments.get(id)
    if (!experiment) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `experiment "${id}" not found` } },
        { status: 404 },
      )
    }

    const managedResults = experiment.documents?.results
    if (!managedResults?.exists) {
      return NextResponse.json(
        { error: { code: 'RESULTS_NOT_FOUND', message: 'results.yaml does not exist' } },
        { status: 404 },
      )
    }

    const [raw, fileStat] = await Promise.all([
      readFile(managedResults.path, 'utf8'),
      stat(managedResults.path),
    ])
    const parsed = parseResultsYaml(raw, managedResults.path)
    const updatedAt = fileStat.mtime.toISOString()
    const snapshotAt = new Date().toISOString()
    if (!parsed.data) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_RESULTS',
            message: parsed.parseErrors[0]?.message ?? 'results.yaml is invalid',
          },
          diagnostics: parsed.parseErrors,
          updatedAt,
          snapshotAt,
        },
        { status: 422 },
      )
    }

    return NextResponse.json({
      document: parsed.data,
      updatedAt,
      snapshotAt,
      warnings: parsed.parseWarnings,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json(
        { error: { code: 'RESULTS_NOT_FOUND', message: 'results.yaml does not exist' } },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: { code: 'RESULTS_READ_FAILED', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
