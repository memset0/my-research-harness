// GET /api/experiments/:id — v3 experiment-doc detail.

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rt = await getRuntime()
    const exp = rt.experiments.get(id)
    if (!exp) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `experiment "${id}" not found` } },
        { status: 404 },
      )
    }
    const memberRuns = exp.frontMatter.runs
      .map((r) => rt.index.get(r))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
    return NextResponse.json({
      id: exp.id,
      project: exp.project,
      path: exp.path,
      mtime: exp.mtime,
      frontMatter: exp.frontMatter,
      sections: exp.sections,
      warningsRaw: exp.warningsRaw,
      parseErrors: exp.parseErrors,
      parseWarnings: exp.parseWarnings,
      memberRuns: memberRuns.map((r) => ({
        id: r.id,
        status: r.frontMatter.status,
        createdAt: r.frontMatter.createdAt,
        updatedAt: r.frontMatter.updatedAt,
        finishedAt: r.frontMatter.finishedAt,
        host: r.frontMatter.host,
        gpus: r.frontMatter.gpus,
        path: r.path,
        // Per-run artifacts surfaced here so the exp detail page can
        // aggregate them at experiment level without firing N requests.
        artifacts: r.sections.artifacts,
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
