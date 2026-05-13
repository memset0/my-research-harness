// PATCH /api/experiments/[id]/archive — toggle the archived field on an
// experiment doc's frontmatter.
//
// Body: { archived: boolean, expectedMtime?: number }
//
// v4 — exp-side archive is new (v3 had no exp-doc archive concept). No
// hard-rule constraint exists for the exp side; archive is always allowed.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import {
  appendJournalEvent,
  formatIsoLocal,
  parseExperimentReadme,
  readExperimentDoc,
  serializeExperimentReadme,
} from '@memon/core'
import { z } from 'zod'
import { getRuntime } from '../../../../../lib/runtime'

export const dynamic = 'force-dynamic'

const PatchBody = z.object({
  archived: z.boolean(),
  expectedMtime: z.number().optional(),
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
    if (parsed.data.expectedMtime !== undefined && stat.mtimeMs !== parsed.data.expectedMtime) {
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
    const prevArchived = parsedDoc.frontMatter.archived
    const target = parsed.data.archived

    if (prevArchived === target) {
      return NextResponse.json({ ok: true, archived: target, mtime: stat.mtimeMs, noop: true })
    }

    parsedDoc.frontMatter.archived = target
    parsedDoc.frontMatter.updatedAt = formatIsoLocal(new Date())
    const newContent = serializeExperimentReadme({
      frontMatter: parsedDoc.frontMatter,
      sections: parsedDoc.sections,
      warningsRaw: parsedDoc.warningsRaw,
    })

    const tmpPath = join(
      dirname(exp.path),
      `.${Date.now()}-${Math.random().toString(36).slice(2)}.archive.tmp`,
    )
    await fs.writeFile(tmpPath, newContent, 'utf8')
    await fs.rename(tmpPath, exp.path)
    const newStat = await fs.stat(exp.path)

    try {
      await appendJournalEvent({
        path: join(project.root, 'docs', 'journal.md'),
        event: {
          timestamp: formatIsoLocal(new Date()),
          tag: 'ARCHIVE',
          body: `\`${id}\` op=${target ? 'archive' : 'unarchive'}`,
        },
      })
    } catch (err) {
      const tmpRollback = join(
        dirname(exp.path),
        `.${Date.now()}-rollback.archive.tmp`,
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

    return NextResponse.json({ ok: true, archived: target, mtime: newStat.mtimeMs })
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}
