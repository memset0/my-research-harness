// GET    /api/experiments/:id  — v3 experiment-doc detail.
// DELETE /api/experiments/:id  — delete the exp doc; cascade-unlinks any
//                                member runs. Pass `?force=true` to allow
//                                deletion of an exp with members.

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import { deleteExperiment, ExperimentHttpError } from '../../../../lib/experiments'

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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rt = await getRuntime()
    const url = new URL(req.url)
    const force = url.searchParams.get('force') === 'true'
    const out = await deleteExperiment(rt, id, force)
    return NextResponse.json({ ok: true, ...out })
  } catch (err) {
    if (err instanceof ExperimentHttpError) {
      const payload = err.payload
        ? { error: { code: err.code, message: err.message }, ...err.payload }
        : { error: { code: err.code, message: err.message } }
      return NextResponse.json(payload, { status: err.status })
    }
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
