// GET /api/experiments — v3 experiment-doc list (one entry per
// docs/experiments/E<NNNN>-<slug>.md). Optional `?project=<name>` filter.
//
// Each entry carries the parsed exp-doc + computed effective_created_at /
// effective_updated_at by joining with member runs from the run index.

import { type NextRequest, NextResponse } from 'next/server'
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
        const effective = computeEffective(e.frontMatter.createdAt, e.frontMatter.updatedAt, memberRuns)
        return {
          id: e.id,
          project: e.project,
          path: e.path,
          mtime: e.mtime,
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
