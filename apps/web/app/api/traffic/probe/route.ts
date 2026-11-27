// Owner-only central→host probe through a Project's own transport.
//
//   POST /api/traffic/probe {host, project, document?, path?}
//     → ProbeResultDto. One probe per Project at a time (409 otherwise); the
//       result is also kept among the last probe results in memory.

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRuntime } from '@/lib/server/runtime'
import { runProbe } from '@/lib/server/traffic/probe'
import {
  TRAFFIC_HEADERS,
  trafficError,
  trafficForbidden,
  trafficOwnerOnly,
} from '@/lib/server/traffic/route-auth'
import { probeDto } from '@/lib/server/traffic/snapshot'
import { trafficTracker } from '@/lib/server/traffic/tracker'

export const dynamic = 'force-dynamic'

const NAME = z.string().regex(/^[A-Za-z0-9_.-]+$/)
const ProbeSchema = z
  .object({
    host: NAME,
    project: NAME,
    document: z
      .object({ kind: z.enum(['wiki', 'report']), id: z.string().regex(/^[WR]\d{4}$/) })
      .strict()
      .refine((d) => (d.kind === 'wiki') === d.id.startsWith('W'), 'kind and id disagree')
      .optional(),
    // An application path: never a URL, never a traversal.
    path: z
      .string()
      .max(1024)
      .refine(
        (p) =>
          p.startsWith('/') &&
          !p.startsWith('//') &&
          !p.includes('\\') &&
          !p.includes('\0') &&
          !p.split('?')[0]!.split('/').includes('..'),
        'invalid service path',
      )
      .optional(),
  })
  .strict()

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!trafficOwnerOnly(req)) return trafficForbidden()
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return trafficError(400, 'INVALID_BODY', 'request body must be JSON')
  }
  const parsed = ProbeSchema.safeParse(body)
  if (!parsed.success)
    return trafficError(400, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'invalid probe')
  const input = parsed.data
  const runtime = await getRuntime()
  if (
    !runtime.config.projects.some((p) => p.name === input.project && (p.host ?? '-') === input.host)
  )
    return trafficError(404, 'NOT_FOUND', 'Project not found')
  const tracker = trafficTracker()
  const key = `${input.host}/${input.project}`
  if (!tracker.claimProbe(key))
    return trafficError(409, 'PROBE_RUNNING', 'A probe of this project is already running')
  try {
    const result = await runProbe(runtime.config, input)
    tracker.addProbe(result)
    return NextResponse.json(probeDto(result), { headers: TRAFFIC_HEADERS })
  } finally {
    tracker.releaseProbe(key)
  }
}
