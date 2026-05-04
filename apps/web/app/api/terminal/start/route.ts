// POST /api/terminal/start — spawn ttyd → tmux → claude.
//
// Returns the iframe URL `/api/terminal/proxy/<sessionName>/`. That path is
// expected to be handled by Caddy (or whatever reverse proxy fronts memon),
// not Next.js — see `add-browser-terminal/specs/browser-terminal/spec.md`
// "Caddy passthrough for ttyd proxy path".

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  TerminalManagerError,
  startSession,
} from '../../../../lib/terminal/manager'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  experimentId: z.string().min(1),
  projectName: z.string().min(1),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      { status: 400 },
    )
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        },
      },
      { status: 400 },
    )
  }

  try {
    const session = await startSession(parsed.data)
    return NextResponse.json({
      sessionName: session.sessionName,
      url: `/api/terminal/proxy/${encodeURIComponent(session.sessionName)}/`,
      port: session.port,
      startedAt: session.startedAt,
      warnings: session.warnings,
    })
  } catch (err) {
    if (err instanceof TerminalManagerError) {
      const status = err.code === 'BAD_REQUEST' ? 400 : 503
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status },
      )
    }
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}
