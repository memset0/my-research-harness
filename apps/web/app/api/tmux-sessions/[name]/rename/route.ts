// POST /api/tmux-sessions/:name/rename — rename a tmux session in place.
//
// Body: { newName: string } where newName matches ^memon-[A-Za-z0-9._-]+$.
// Tears down the manager's ttyd entry for the old name before issuing
// `tmux rename-session`, so the manager Map doesn't keep a key pointing
// at a session that no longer exists by that name.

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { renameTmuxSession } from '../../../../../lib/terminal/tmux-discover'

export const dynamic = 'force-dynamic'

const NAME_RE = /^memon-[A-Za-z0-9._-]+$/

const BodySchema = z.object({
  newName: z
    .string()
    .min(1)
    .regex(NAME_RE, 'newName must match memon-[A-Za-z0-9._-]+'),
})

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await ctx.params
  const oldName = decodeURIComponent(rawName)

  if (!NAME_RE.test(oldName)) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'name must match memon-[A-Za-z0-9._-]+',
        },
      },
      { status: 400 },
    )
  }

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

  const { newName } = parsed.data
  if (oldName === newName) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'newName must differ from oldName',
        },
      },
      { status: 400 },
    )
  }

  try {
    await renameTmuxSession({ oldName, newName })
    return NextResponse.json({ ok: true, sessionName: newName })
  } catch (err) {
    const e = err as Error & { code?: string }
    if (e.code === 'NOT_FOUND') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'tmux session not found' } },
        { status: 404 },
      )
    }
    if (e.code === 'CONFLICT') {
      return NextResponse.json(
        { error: { code: 'CONFLICT', message: e.message } },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: { message: e.message } },
      { status: 500 },
    )
  }
}
