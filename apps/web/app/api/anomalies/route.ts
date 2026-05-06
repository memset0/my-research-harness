// GET /api/anomalies?project=<name> — current experiment ↔ run binding
// anomalies (ORPHAN_RUN / PHANTOM_RUN_REF / MISMATCH_EXPERIMENT_REF).

import type { ExperimentMembershipAnomaly } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const projectFilter = url.searchParams.get('project')

    const anomalies: ExperimentMembershipAnomaly[] = []
    for (const [projectName, list] of rt.anomaliesByProject) {
      if (projectFilter && projectName !== projectFilter) continue
      anomalies.push(...list)
    }
    // Sort by detectedAt descending.
    anomalies.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
    return NextResponse.json({ anomalies })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
