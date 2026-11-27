import type { NextRequest } from 'next/server'
import { discussionCitationsRoute } from '@/lib/server/discussion-route'
import { withStandaloneRequest } from '@/lib/server/standalone-request'
export const dynamic = 'force-dynamic'
export const GET = withStandaloneRequest(async (request: NextRequest) =>
  discussionCitationsRoute(request),
)
