// POST /api/terminal/stop — kill ttyd; tmux session is left detached.

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { stopSession } from '../../../../lib/terminal/manager'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({ sessionName: z.string().min(1) })

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
  const result = await stopSession(parsed.data.sessionName)
  return NextResponse.json(result)
}
