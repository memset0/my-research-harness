// Cluster overview (admin and above, via `access_clusters`): registered nodes, their GPUs and current use.
// Probes run read-only `nvidia-smi` through each node's own transport; see
// lib/server/cluster/probe.ts for the bounds.

import { NodeAccessError } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { readIdentityFromRequest } from '@/lib/server/auth/request-context'
import { canAccessClusters } from '@/lib/server/cluster/access'
import { getClusterOverview } from '@/lib/server/cluster/overview'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const identity = readIdentityFromRequest(req)
  if (!canAccessClusters(identity)) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'the cluster overview requires the access_clusters capability',
        },
      },
      { status: 403, headers: HEADERS },
    )
  }
  try {
    const refresh = req.nextUrl.searchParams.get('refresh') === '1'
    return NextResponse.json(await getClusterOverview(refresh, identity), { headers: HEADERS })
  } catch (err) {
    if (err instanceof NodeAccessError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 500, headers: HEADERS },
      )
    }
    return NextResponse.json(
      { error: { code: 'CLUSTERS_UNAVAILABLE', message: (err as Error).message } },
      { status: 500, headers: HEADERS },
    )
  }
}
