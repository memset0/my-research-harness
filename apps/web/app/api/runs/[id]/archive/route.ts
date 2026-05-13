// PATCH /api/runs/[id]/archive — toggle the archived field on a run README.
//
// Body: { archived: boolean, expectedMtime?: number }
//
// v4 — replaces the legacy `<runDir>/.archived` sidecar mechanism. The
// archive flag now lives in the README's frontmatter and participates in
// the same atomic-write + JOURNAL `[ARCHIVE]` flow as status set, per
// `archive-frontmatter` spec. Hard rule: refuses `archived: true` when the
// current `status === 'RUNNING'` (HTTP 422).

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import {
  appendJournalEvent,
  formatIsoLocal,
  parseReadme,
  readRunDir,
  reserializeReadme,
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
    const exp = rt.index.get(id)
    if (!exp) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `run "${id}" not found` } },
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

    const readmePath = join(exp.path, 'README.md')
    const stat = await fs.stat(readmePath)
    if (parsed.data.expectedMtime !== undefined && stat.mtimeMs !== parsed.data.expectedMtime) {
      const current = await fs.readFile(readmePath, 'utf8')
      return NextResponse.json(
        {
          error: { code: 'CONFLICT', message: 'on-disk mtime differs from expectedMtime' },
          mtime: stat.mtimeMs,
          content: current,
        },
        { status: 409 },
      )
    }

    const currentContent = await fs.readFile(readmePath, 'utf8')
    const parsedReadme = parseReadme(currentContent)
    const prevArchived = parsedReadme.frontMatter.archived
    const currentStatus = parsedReadme.frontMatter.status
    const target = parsed.data.archived

    if (prevArchived === target) {
      return NextResponse.json({ ok: true, archived: target, mtime: stat.mtimeMs, noop: true })
    }

    // Hard rule: cannot archive a RUNNING run.
    if (target === true && currentStatus === 'RUNNING') {
      return NextResponse.json(
        {
          error: {
            code: 'ARCHIVE_RUNNING_FORBIDDEN',
            message:
              'cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first',
            id,
          },
        },
        { status: 422 },
      )
    }

    parsedReadme.frontMatter.archived = target
    parsedReadme.frontMatter.updatedAt = formatIsoLocal(new Date())
    const newContent = reserializeReadme(parsedReadme)

    const tmpPath = join(
      dirname(readmePath),
      `.${Date.now()}-${Math.random().toString(36).slice(2)}.archive.tmp`,
    )
    await fs.writeFile(tmpPath, newContent, 'utf8')
    await fs.rename(tmpPath, readmePath)
    const newStat = await fs.stat(readmePath)

    const timestamp = formatIsoLocal(new Date())
    try {
      await appendJournalEvent({
        path: join(project.root, 'docs', 'journal.md'),
        event: {
          timestamp,
          tag: 'ARCHIVE',
          body: `\`${id}\` op=${target ? 'archive' : 'unarchive'}`,
        },
      })
    } catch (err) {
      // Roll back README on JOURNAL failure.
      const tmpRollback = join(
        dirname(readmePath),
        `.${Date.now()}-rollback.archive.tmp`,
      )
      await fs.writeFile(tmpRollback, currentContent, 'utf8')
      await fs.rename(tmpRollback, readmePath)
      throw err
    }

    try {
      const updated = await readRunDir(exp.path, project.name)
      rt.index.set(updated)
      rt.events.emit('run-change', {
        type: 'set',
        id: updated.id,
        experiment: updated,
        parentExperimentId: updated.frontMatter.experiment ?? null,
      })
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
