// GET /api/slurm/status — Slurm cluster status (current user's jobs only).
//
// Owner-only `read` route (registered with `projectFor: 'global'` so viewer
// share cookies don't pass). See openspec/changes/add-slurm-status-widget/
// specs/slurm-status/spec.md for the payload contract.

import { NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import { runSqueueMe } from '../../../../lib/slurm/squeue'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rt = await getRuntime()

  if (!rt.slurm.enabled) {
    return NextResponse.json({ enabled: false })
  }

  try {
    const jobs = await runSqueueMe()
    const usedNodes = jobs
      .filter((j) => j.state === 'R')
      .reduce((sum, j) => sum + j.numNodes, 0)
    return NextResponse.json({
      enabled: true,
      totalNodes: rt.slurm.totalNodes,
      usedNodes,
      jobs,
    })
  } catch (err) {
    return NextResponse.json(
      {
        enabled: true,
        error: {
          code: 'SLURM_UNAVAILABLE',
          message: (err as Error).message,
        },
      },
      { status: 500 },
    )
  }
}
