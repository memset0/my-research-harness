// POST /api/open-claude-code — return a copy-paste command for opening
// Claude Code in the working directory of an exp doc or run.
//
// Body: { kind: 'exp' | 'run', id: string, projectName: string }
//
// We deliberately do NOT spawn a process here — the same memon serve can be
// shared across users on a cluster, so spawning Claude Code on the server
// would launch in the wrong session (or worse, with someone else's
// credentials). The button on the client side copies the returned command
// to the clipboard so the user can paste it into a local terminal.

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { join } from 'node:path'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  kind: z.enum(['exp', 'run']),
  id: z.string().min(1),
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

  const rt = await getRuntime()
  const project = rt.config.projects.find((p) => p.name === parsed.data.projectName)
  if (!project) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `project "${parsed.data.projectName}" not configured`,
        },
      },
      { status: 404 },
    )
  }

  let cwd: string
  let hint: string
  if (parsed.data.kind === 'exp') {
    const exp = rt.experiments.get(parsed.data.id)
    if (!exp) {
      return NextResponse.json(
        {
          error: { code: 'NOT_FOUND', message: `experiment "${parsed.data.id}" not found` },
        },
        { status: 404 },
      )
    }
    // For exp-level work, drop the user at the project root with the exp
    // doc path quoted so they can hand it to Claude Code as a focus arg.
    cwd = project.root
    const relPath = exp.path.startsWith(project.root + '/')
      ? exp.path.slice(project.root.length + 1)
      : exp.path
    hint = `Edit ${relPath} (experiment ${parsed.data.id})`
  } else {
    const run = rt.index.get(parsed.data.id)
    if (!run) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `run "${parsed.data.id}" not found` } },
        { status: 404 },
      )
    }
    cwd = run.path
    hint = `Open run ${parsed.data.id}`
  }
  const command = `cd ${shellQuote(cwd)} && claude`
  return NextResponse.json({ command, cwd, hint })
}

function shellQuote(s: string): string {
  // Conservative single-quote wrapping with escape for embedded quotes.
  // Sufficient for the working-dir paths memon serves; we never embed
  // user-controlled content here.
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

void join // silence unused import (kept for future cwd derivation needs)
