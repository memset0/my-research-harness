import type { NextRequest } from 'next/server'
import { discussionRoute } from '@/lib/server/discussion-route'
import { withStandaloneRequest } from '@/lib/server/standalone-request'
export const dynamic = 'force-dynamic'
export const POST = withStandaloneRequest(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
    discussionRoute(request, (await context.params).id, 'status'),
)
