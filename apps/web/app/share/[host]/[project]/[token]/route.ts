// GET /share/<host>/<project>/<token> — an earlier Host-qualified share URL.
// It sets no cookie itself: it redirects to the Project page carrying
// `?share=<token>`, which the middleware redeems like any page link.

import { BackendShareValidationRequestSchema, HostIdSchema, ProjectNameSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { projectBasePath } from '@/lib/project-routes'
import { publicOrigin } from '@/lib/server/auth/public-url'
import { invalidShareLinkResponse } from '@/lib/server/share-landing'

interface RouteParams {
  params: Promise<{ host: string; project: string; token: string }>
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const raw = await ctx.params
  const host = HostIdSchema.safeParse(raw.host)
  const project = ProjectNameSchema.safeParse(raw.project)
  const token = BackendShareValidationRequestSchema.safeParse({ token: raw.token })
  if (!host.success || !project.success || !token.success) return invalidShareLinkResponse()
  const target = new URL(
    projectBasePath({ host: host.data, project: project.data }),
    publicOrigin(req),
  )
  target.searchParams.set('share', token.data.token)
  return new NextResponse(null, {
    status: 302,
    headers: { Location: target.toString(), 'Cache-Control': 'no-store' },
  })
}
