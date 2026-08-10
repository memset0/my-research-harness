// GET  /api/experiments — v3 experiment-doc list (one entry per
//                         docs/experiments/E<NNNN>-<slug>.md).
//                         Optional `?project=<name>` filter.
// POST /api/experiments — create a new exp doc; web equivalent of
//                         `memon experiment create`.
//
// Each GET entry carries the parsed exp-doc + computed effective_created_at /
// effective_updated_at by joining with member runs from the run index.

import { type NextRequest, NextResponse } from 'next/server'
import { createExperiment, ExperimentHttpError } from '../../../lib/experiments'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const projectFilter = url.searchParams.get('project')

    const experiments = Array.from(rt.experiments.values()).filter(
      (e) => !projectFilter || e.project === projectFilter,
    )

    const runIndex = rt.index
    return NextResponse.json({
      experiments: experiments.map((e) => {
        const memberRuns = e.frontMatter.runs
          .map((r) => runIndex.get(r))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
        const effective = computeEffective(
          e.frontMatter.createdAt,
          e.frontMatter.updatedAt,
          memberRuns,
        )
        return {
          id: e.id,
          project: e.project,
          path: e.path,
          mtime: e.mtime,
          readmeMtime: e.readmeMtime,
          frontMatter: e.frontMatter,
          sections: e.sections,
          warningsRaw: e.warningsRaw,
          parseErrors: e.parseErrors,
          parseWarnings: e.parseWarnings,
          effectiveCreatedAt: effective.createdAt,
          effectiveUpdatedAt: effective.updatedAt,
          memberRuns: memberRuns.map((r) => ({
            id: r.id,
            status: r.frontMatter.status,
            archived: r.frontMatter.archived,
            createdAt: r.frontMatter.createdAt,
            updatedAt: r.frontMatter.updatedAt,
            finishedAt: r.frontMatter.finishedAt,
            host: r.frontMatter.host,
            gpus: r.frontMatter.gpus,
          })),
        }
      }),
    })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}

interface PostBody {
  project?: string
  slug: string
  title?: string
  hypotheses?: string[]
  tags?: string[]
  fromRun?: string | null
}

export async function POST(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const body = (await req.json()) as PostBody
    if (typeof body.slug !== 'string') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'slug is required' } },
        { status: 400 },
      )
    }
    // If project omitted and only one project is configured, default to it.
    let project = body.project
    if (!project) {
      if (rt.config.projects.length === 1) {
        project = rt.config.projects[0]!.name
      } else {
        return NextResponse.json(
          {
            error: {
              code: 'BAD_REQUEST',
              message: 'project is required when multiple projects are configured',
            },
          },
          { status: 400 },
        )
      }
    }
    const out = await createExperiment(rt, {
      project,
      slug: body.slug,
      title: body.title,
      hypotheses: body.hypotheses,
      tags: body.tags,
      fromRun: body.fromRun ?? null,
    })
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

function computeEffective(
  expCreatedAt: string,
  expUpdatedAt: string,
  members: Array<{ frontMatter: { createdAt: string; updatedAt: string } }>,
): { createdAt: string; updatedAt: string } {
  if (members.length === 0) {
    return { createdAt: expCreatedAt, updatedAt: expUpdatedAt }
  }
  const created = [expCreatedAt, ...members.map((m) => m.frontMatter.createdAt)]
    .filter(Boolean)
    .sort()
  const updated = [expUpdatedAt, ...members.map((m) => m.frontMatter.updatedAt)]
    .filter(Boolean)
    .sort()
  return {
    createdAt: created[0] ?? expCreatedAt,
    updatedAt: updated[updated.length - 1] ?? expUpdatedAt,
  }
}
