import type { NextRequest } from 'next/server'
import { discussionRoute } from '@/lib/server/discussion-route'
import { withStandaloneRequest } from '@/lib/server/standalone-request'
export const dynamic = 'force-dynamic'
export const GET = withStandaloneRequest((request: NextRequest) => discussionRoute(request))
