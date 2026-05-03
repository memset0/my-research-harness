import { type NextRequest, NextResponse } from 'next/server'
import {
  ExperimentExistsError,
  createExperimentScaffold,
  isStaleRunning,
  readExperimentDir,
} from '@memon/core'
import { z } from 'zod'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const project = url.searchParams.get('project') ?? undefined
    const experiments = rt.index.list({ project })
    return NextResponse.json({
      experiments: experiments.map((e) => ({
        id: e.id,
        path: e.path,
        mtime: e.mtime,
        hasReadme: e.hasReadme,
        frontMatter: e.frontMatter,
        parseErrors: e.parseErrors,
        parseWarnings: e.parseWarnings,
        stale: isStaleRunning(e),
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}

const PostBodySchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'name must be alphanumeric / dash / underscore'),
  project: z.string().min(1).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const body = await req.json().catch(() => null)
    const parsed = PostBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: parsed.error.issues
              .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
              .join('; '),
          },
        },
        { status: 400 },
      )
    }

    const projectName = parsed.data.project ?? rt.config.projects[0]?.name
    if (!projectName) {
      return NextResponse.json(
        { error: { code: 'CONFIG_ERROR', message: 'no projects configured' } },
        { status: 500 },
      )
    }
    const project = rt.config.projects.find((p) => p.name === projectName)
    if (!project) {
      return NextResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `project "${projectName}" not configured`,
          },
        },
        { status: 404 },
      )
    }

    let result: Awaited<ReturnType<typeof createExperimentScaffold>>
    try {
      result = await createExperimentScaffold({
        projectRoot: project.root,
        projectName: project.name,
        name: parsed.data.name,
      })
    } catch (err) {
      if (err instanceof ExperimentExistsError) {
        return NextResponse.json(
          { error: { code: 'CONFLICT', message: err.message } },
          { status: 409 },
        )
      }
      throw err
    }

    // Update the runtime index immediately so subsequent GETs reflect the new
    // row, and emit an event so other tabs see it via SSE.
    try {
      const exp = await readExperimentDir(result.path, project.name)
      rt.index.set(exp)
      rt.events.emit('experiment-change', { type: 'set', id: exp.id, experiment: exp })
      rt.poller.watch(result.path, exp.mtime)
    } catch {
      // Index update is best-effort; the scaffold itself succeeded
    }

    return NextResponse.json({
      created: { id: result.id, path: result.path, project: project.name },
    })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
