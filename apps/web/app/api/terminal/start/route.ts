// POST /api/terminal/start — spawn ttyd → tmux → agent (per tmux-session-rework).
//
// Request body: `{ project, scope: 'exp' | 'run', slug, agent? }`.
// Server resolves cwd from runtime indexes (run dir for `run`, project root
// for `exp`); falls back to project root or HOME with a `warnings` entry
// if the target cannot be matched.
//
// Returns the iframe URL `/api/terminal/proxy/<sessionName>/`. That path is
// expected to be handled by Caddy (or whatever reverse proxy fronts memon)
// + the custom server's per-sessionName routing.

import { homedir } from 'node:os'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  TerminalManagerError,
  startSession,
} from '../../../../lib/terminal/manager'
import { getRuntime } from '../../../../lib/runtime'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  project: z.string().min(1).regex(/^[A-Za-z0-9-]+$/, 'project must match [A-Za-z0-9-]+'),
  scope: z.enum(['exp', 'run']),
  slug: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9._-]+$/, 'slug must match [A-Za-z0-9._-]+')
    .refine((s) => !s.includes('--'), {
      message: "slug must not contain '--' (the scope delimiter)",
    }),
  agent: z.enum(['none', 'claude', 'codex', 'opencode']).optional(),
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
  const project = runtime.config.projects.find((p) => p.name === parsed.data.project)

  // Resolve cwd; pre-warnings carry the "I had to fall back" message into
  // the response so the management page's stale-row Open path surfaces a
  // warning instead of failing silently.
  const preWarnings: string[] = []
  let cwd: string
  if (project) {
    if (parsed.data.scope === 'run') {
      const run = runtime.index.list({ project: project.name }).find((r) => r.id === parsed.data.slug)
      if (run) {
        cwd = run.path
      } else {
        cwd = project.root
        preWarnings.push(
          `target run "${parsed.data.slug}" not found in project "${project.name}"; opened at project root`,
        )
      }
    } else {
      // exp scope — open at project root regardless of whether exp doc exists.
      cwd = project.root
      const expFound = Array.from(runtime.experiments.values()).some(
        (e) => e.project === project.name && e.id === parsed.data.slug,
      )
      if (!expFound) {
        preWarnings.push(
          `exp "${parsed.data.slug}" not found in project "${project.name}"; opened at project root`,
        )
      }
    }
  } else {
    cwd = homedir()
    preWarnings.push(
      `project "${parsed.data.project}" not in config; opened at HOME`,
    )
  }

  try {
    const session = await startSession({
      project: parsed.data.project,
      scope: parsed.data.scope,
      slug: parsed.data.slug,
      agent: parsed.data.agent,
      cwd,
      maxConcurrent: runtime.config.terminal.ttydMaxConcurrent,
      idleTtlMinutes: runtime.config.terminal.ttydIdleTtlMinutes,
    })
    return NextResponse.json({
      sessionName: session.sessionName,
      url: `/api/terminal/proxy/${encodeURIComponent(session.sessionName)}/`,
      port: session.port,
      startedAt: session.startedAt,
      warnings: [...preWarnings, ...session.warnings],
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
