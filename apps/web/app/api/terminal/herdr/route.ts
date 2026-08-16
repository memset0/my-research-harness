// POST /api/terminal/herdr — attach ttyd directly to the configured Herdr
// client, optionally creating/focusing a target workspace first.

import { homedir } from 'node:os'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRuntime } from '../../../../lib/runtime'
import { startHerdrSession, TerminalManagerError } from '../../../../lib/terminal/manager'

export const dynamic = 'force-dynamic'

const BodySchema = z
  .object({
    project: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
    scope: z.enum(['exp', 'run', 'project']).optional(),
    slug: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._-]+$/)
      .refine((value) => !value.includes('--'), "slug must not contain '--'")
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const count = [value.project, value.scope, value.slug].filter(Boolean).length
    if (count !== 0 && count !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'project, scope, and slug must be supplied together',
      })
    }
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
          message: parsed.error.issues.map((issue) => issue.message).join('; '),
        },
      },
      { status: 400 },
    )
  }

  const runtime = await getRuntime()
  const herdr = runtime.config.terminal.herdr
  if (!herdr) {
    return NextResponse.json(
      { error: { code: 'INTEGRATION_DISABLED', message: 'Herdr integration is not configured' } },
      { status: 404 },
    )
  }

  const data = parsed.data
  const warnings: string[] = []
  let cwd = process.cwd()
  let target: { label: string; cwd: string } | undefined
  if (data.project && data.scope && data.slug) {
    const project = runtime.config.projects.find((candidate) => candidate.name === data.project)
    if (!project) {
      cwd = homedir()
      warnings.push(`project "${data.project}" not in config; opened at HOME`)
    } else if (data.scope === 'run') {
      const run = runtime.index
        .list({ project: project.name })
        .find((candidate) => candidate.id === data.slug)
      cwd = run?.path ?? project.root
      if (!run) {
        warnings.push(
          `target run "${data.slug}" not found in project "${project.name}"; opened at project root`,
        )
      }
    } else {
      cwd = project.root
      if (data.scope === 'exp') {
        const found = Array.from(runtime.experiments.values()).some(
          (experiment) => experiment.project === project.name && experiment.id === data.slug,
        )
        if (!found) {
          warnings.push(
            `exp "${data.slug}" not found in project "${project.name}"; opened at project root`,
          )
        }
      }
    }
    target = {
      label: data.scope === 'project' ? data.project : data.slug,
      cwd,
    }
  }

  try {
    const session = await startHerdrSession({
      cli: herdr.cli,
      cwd,
      ...(target ? { target } : {}),
      maxConcurrent: runtime.config.terminal.ttydMaxConcurrent,
      idleTtlMinutes: runtime.config.terminal.ttydIdleTtlMinutes,
    })
    return NextResponse.json({
      sessionName: session.sessionName,
      url: `/api/terminal/proxy/${encodeURIComponent(session.sessionName)}/`,
      port: session.port,
      startedAt: session.startedAt,
      warnings: [...warnings, ...session.warnings],
    })
  } catch (err) {
    if (err instanceof TerminalManagerError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.code === 'BAD_REQUEST' ? 400 : 503 },
      )
    }
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
