// GET /api/runtime/health
//
// Lightweight diagnostic surface — confirms warmup completed, reports cache
// occupancy, surfaces the most recent runtime error. Used during validation
// and as a quick way to verify add-runtime-cache is working in prod.

import { NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const rt = await getRuntime()
    const hyps = rt.hypothesesCache.inspect()
    const jrn = rt.journalCache.inspect()
    return NextResponse.json({
      warmupAt: new Date(rt.warmupAt).toISOString(),
      uptimeMs: Date.now() - rt.warmupAt,
      projects: rt.config.projects.length,
      experiments: rt.index.size(),
      hypothesesCached: hyps.populated,
      hypothesesTotal: hyps.total,
      journalsCached: jrn.populated,
      journalsTotal: jrn.total,
      lastError: rt.lastError,
    })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
