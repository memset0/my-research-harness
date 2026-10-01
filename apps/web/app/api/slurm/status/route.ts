// GET /api/slurm/status — Slurm cluster status (current user's jobs only).
//
// Owner-only `read` route (registered with `projectFor: 'global'` so viewer
// share cookies don't pass). See openspec/changes/add-slurm-status-widget/
// specs/slurm-status/spec.md for the payload contract.

import { NextResponse } from 'next/server'
import type { SlurmStatus } from '@/lib/dto/slurm'
import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneServices } from '../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rt = await getRuntime()

  if (!rt.slurm.enabled) {
    return NextResponse.json({ enabled: false } satisfies SlurmStatus)
  }

  const service = standaloneServices(rt.config).slurm
  if (!service) return NextResponse.json({ enabled: false } satisfies SlurmStatus)
  try {
    return NextResponse.json((await service.status()) satisfies SlurmStatus)
  } catch (err) {
    return NextResponse.json(
      {
        enabled: true,
        error: {
          code: 'SLURM_UNAVAILABLE',
          message: (err as Error).message,
        },
      } satisfies SlurmStatus,
      { status: 500 },
    )
  }
}
