// GET /share/<project>/<token> — the retired hostless share landing. A hostless
// link cannot name a Host and its tokens came from the retired per-project
// store, so every request gets the generic invalid-link page and spends a
// rate-limit token; no cookie is set.

import { type NextRequest, NextResponse } from 'next/server'
import { clientIpFromHeaders, consume } from '@/lib/server/auth/rate-limit'
import { invalidShareLinkResponse } from '@/lib/server/share-landing'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limit = consume(clientIpFromHeaders(req.headers))
  if (!limit.ok) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': String(limit.retryAfter ?? 60) },
    })
  }
  return invalidShareLinkResponse()
}
