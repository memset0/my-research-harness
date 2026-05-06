// PATCH /api/experiments/[id]/status — update status atomically.
//
// Body: { status: Status, expectedMtime: number, expectedHash?: string }
//
// Server reads the current README, swaps just the front-matter `status` field,
// and writes back via the same mtime-locked atomic path as PUT /api/readme.
// The accompanying [STATUS] event in docs/journal.md is paired (rollback on failure).
//
// Why this lives separately from PUT /api/readme: the client only sends a tiny
// payload (`{status, expectedMtime}`) and doesn't need to reconstruct the full
// README content. Keeps serializeReadme out of the client bundle.

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import {
  STATUS_VALUES,
  appendJournalEvent,
  formatIsoLocal,
  parseReadme,
  readExperimentDir,
  reserializeReadme,
  type Status,
} from '@memon/core'
import { z } from 'zod'
import { getRuntime } from '../../../../../lib/runtime'

export const dynamic = 'force-dynamic'

const PatchBody = z.object({
  status: z.enum(STATUS_VALUES as readonly [Status, ...Status[]]),
  expectedMtime: z.number(),
  expectedHash: z.string().optional(),
})

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rt = await getRuntime()
    const { id } = await ctx.params
    const exp = rt.index.get(id)
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

    const body = await req.json().catch(() => null)
    const parsed = PatchBody.safeParse(body)
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

    // mtime check
    if (stat.mtimeMs !== parsed.data.expectedMtime) {
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

    // Optional hash check
    if (parsed.data.expectedHash) {
      const currentHash = createHash('sha1').update(currentContent).digest('hex')
      if (currentHash !== parsed.data.expectedHash) {
        return NextResponse.json(
          {
            error: { code: 'CONFLICT', message: 'on-disk content hash differs from expectedHash' },
            mtime: stat.mtimeMs,
            content: currentContent,
          },
          { status: 409 },
        )
      }
    }

    const parsedReadme = parseReadme(currentContent)
    const prevStatus = parsedReadme.frontMatter.status
    const nextStatus = parsed.data.status

    if (prevStatus === nextStatus) {
      return NextResponse.json({ mtime: stat.mtimeMs, unchanged: true })
    }

    parsedReadme.frontMatter.status = nextStatus
    // Also bump finishedAt when going to a terminal state and it's currently null
    if (
      (nextStatus === 'FINISHED' || nextStatus === 'FAILED') &&
      parsedReadme.frontMatter.finishedAt === null
    ) {
      parsedReadme.frontMatter.finishedAt = formatIsoLocal(new Date())
    }
    // And clear finishedAt when going back to RUNNING/PENDING
    if (
      (nextStatus === 'RUNNING' || nextStatus === 'PENDING') &&
      parsedReadme.frontMatter.finishedAt !== null
    ) {
      parsedReadme.frontMatter.finishedAt = null
    }

    const newContent = reserializeReadme(parsedReadme)

    // Atomic write: temp file -> rename
    const tmpPath = join(
      dirname(readmePath),
      `.${Date.now()}-${Math.random().toString(36).slice(2)}.readme.tmp`,
    )
    await fs.writeFile(tmpPath, newContent, 'utf8')
    await fs.rename(tmpPath, readmePath)
    const newStat = await fs.stat(readmePath)

    // Pair: append [STATUS] to docs/journal.md. If it fails, roll back the README.
    const timestamp = formatIsoLocal(new Date())
    try {
      await appendJournalEvent({
        path: join(project.root, 'docs', 'journal.md'),
        event: {
          timestamp,
          tag: 'STATUS',
          body: `\`${id}\` ${prevStatus} → ${nextStatus}`,
        },
      })
    } catch (err) {
      // Roll back README to prior content
      const tmpRollback = join(
        dirname(readmePath),
        `.${Date.now()}-rollback.readme.tmp`,
      )
      await fs.writeFile(tmpRollback, currentContent, 'utf8')
      await fs.rename(tmpRollback, readmePath)
      throw err
    }

    // Update in-memory index immediately and broadcast
    try {
      const updated = await readExperimentDir(exp.path, project.name)
      rt.index.set(updated)
      rt.events.emit('experiment-change', { type: 'set', id: updated.id, experiment: updated })
    } catch {
      // best-effort
    }

    return NextResponse.json({ mtime: newStat.mtimeMs, prevStatus, nextStatus })
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}
