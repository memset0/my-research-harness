// POST /api/terminal/attach — attach ttyd to an existing tmux session by name.
//
// This is the raw-attach path used for "manual" rows on /manage/tmux
// (legacy or arbitrary `memon-*` names where no parsed `(agent, project,
// scope, slug)` is available). Body shape is just `{ sessionName }`; the
// server spawns ttyd with `tmux new-session -A -s <sessionName>` (no -c,
// no agent CLI tail).
//
// Per-sessionName dedup is shared with `/api/terminal/start` via the
// manager's `state.startChains` Map, so concurrent attach + start calls
// for the same sessionName produce a single ttyd entry.

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRuntime } from '../../../../lib/runtime'
import { attachExistingSession, TerminalManagerError } from '../../../../lib/terminal/manager'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  sessionName: z
    .string()
    .min(1)
    .regex(/^memon-[A-Za-z0-9._-]+$/, 'sessionName must match memon-[A-Za-z0-9._-]+'),
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

  const runtime = await getRuntime()
  if (runtime.config.terminal?.tmuxEnabled === false) {
    return NextResponse.json(
      { error: { code: 'INTEGRATION_DISABLED', message: 'tmux integration is disabled' } },
      { status: 404 },
    )
  }
  try {
    const session = await attachExistingSession({
      sessionName: parsed.data.sessionName,
      maxConcurrent: runtime.config.terminal.ttydMaxConcurrent,
      idleTtlMinutes: runtime.config.terminal.ttydIdleTtlMinutes,
    })
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
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status })
    }
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
