// PATCH /api/experiments/[id]/status — update ExperimentStatus atomically.
//
// Body: { status: ExperimentStatus, expectedMtime: number }
//
// v4 — paired [EXP_STATUS] event in docs/journal.md (rollback on failure).
// Mirrors PATCH /api/runs/[id]/status but on the exp-doc frontmatter.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import {
  EXPERIMENT_STATUS_VALUES,
  appendJournalEvent,
  formatIsoLocal,
  parseExperimentReadme,
  readExperimentDoc,
  serializeExperimentReadme,
  type ExperimentStatus,
} from '@memon/core'
import { z } from 'zod'
import { getRuntime } from '../../../../../lib/runtime'

export const dynamic = 'force-dynamic'

const PatchBody = z.object({
  status: z.enum(EXPERIMENT_STATUS_VALUES as readonly [ExperimentStatus, ...ExperimentStatus[]]),
  expectedMtime: z.number(),
})

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rt = await getRuntime()
    const { id } = await ctx.params
    const exp = rt.experiments.get(id)
    if (!exp) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `experiment "${id}" not found` } },
        { status: 404 },
      )
    }
    const project = rt.projectFor(exp.path)
    if (!project) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'owning project not found' } },
        { status: 404 },
      )
    }

    const parsed = PatchBody.safeParse(await req.json().catch(() => null))
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

    const stat = await fs.stat(exp.path)
    if (stat.mtimeMs !== parsed.data.expectedMtime) {
      const current = await fs.readFile(exp.path, 'utf8')
      return NextResponse.json(
        {
          error: { code: 'CONFLICT', message: 'on-disk mtime differs from expectedMtime' },
          mtime: stat.mtimeMs,
          content: current,
        },
        { status: 409 },
      )
    }

    const currentContent = await fs.readFile(exp.path, 'utf8')
    const parsedDoc = parseExperimentReadme(currentContent, id)
    const prevStatus = parsedDoc.frontMatter.status
    const prevArchived = parsedDoc.frontMatter.archived
    const nextStatus = parsed.data.status

    if (prevStatus === nextStatus) {
      const noopResponse: Record<string, unknown> = { mtime: stat.mtimeMs, unchanged: true }
      if (prevArchived) noopResponse.warning = 'archived'
      return NextResponse.json(noopResponse)
    }

    parsedDoc.frontMatter.status = nextStatus
    parsedDoc.frontMatter.updatedAt = formatIsoLocal(new Date())
    const newContent = serializeExperimentReadme({
      frontMatter: parsedDoc.frontMatter,
      sections: parsedDoc.sections,
      warningsRaw: parsedDoc.warningsRaw,
    })

    const tmpPath = join(
      dirname(exp.path),
      `.${Date.now()}-${Math.random().toString(36).slice(2)}.exp-status.tmp`,
    )
    await fs.writeFile(tmpPath, newContent, 'utf8')
    await fs.rename(tmpPath, exp.path)
    const newStat = await fs.stat(exp.path)

    try {
      await appendJournalEvent({
        path: join(project.root, 'docs', 'journal.md'),
        event: {
          timestamp: formatIsoLocal(new Date()),
          tag: 'EXP_STATUS',
          body: `\`${id}\` ${prevStatus} → ${nextStatus}`,
        },
      })
    } catch (err) {
      const tmpRollback = join(
        dirname(exp.path),
        `.${Date.now()}-rollback.exp-status.tmp`,
      )
      await fs.writeFile(tmpRollback, currentContent, 'utf8')
      await fs.rename(tmpRollback, exp.path)
      throw err
    }

    try {
      const updated = await readExperimentDoc(project.root, project.name, id)
      if (updated) {
        rt.experiments.set(id, updated)
        rt.recomputeAnomalies(project.name)
        rt.events.emit('experiment-change', { type: 'set', id, experiment: updated })
      }
    } catch {
      // best-effort
    }

    const responseBody: Record<string, unknown> = {
      mtime: newStat.mtimeMs,
      prevStatus,
      nextStatus,
    }
    if (prevArchived) responseBody.warning = 'archived'
    return NextResponse.json(responseBody)
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}
