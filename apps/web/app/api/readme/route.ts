// PUT /api/readme — write a README.md with mtime optimistic locking.
//
// Body: { path: string, content: string, expectedMtime: number, expectedHash?: string }
//
// Behavior:
//   - 200 + { mtime } on success; appends a [STATUS] event to docs/journal.md if
//     the front matter `status` field changed
//   - 409 + { mtime, content } when on-disk mtime ≠ expectedMtime
//   - 409 also if mtime matches but content hash differs (defends against
//     low-resolution mtime on NFS)
//   - 403 if path escapes any configured project root

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import {
  appendJournalEvent,
  parseReadme,
  readExperimentDir,
  type Status,
} from '@memon/core'
import { getRuntime } from '../../../lib/runtime'
import { PathSafetyError, assertWithinProjectRoots } from '../../../lib/path-safety'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const pathParam = url.searchParams.get('path')
    if (!pathParam) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'path query parameter required' } },
        { status: 400 },
      )
    }
    let safePath: string
    try {
      safePath = assertWithinProjectRoots(pathParam, rt.config)
    } catch (err) {
      if (err instanceof PathSafetyError) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: err.message } },
          { status: 403 },
        )
      }
      throw err
    }
    const stat = await fs.stat(safePath)
    const content = await fs.readFile(safePath, 'utf8')
    const hash = createHash('sha1').update(content).digest('hex')
    return NextResponse.json({ path: safePath, content, mtime: stat.mtimeMs, hash })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}

interface PutBody {
  path: string
  content: string
  expectedMtime: number
  expectedHash?: string
}

export async function PUT(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const body = (await req.json()) as PutBody

    if (!body.path || typeof body.content !== 'string' || typeof body.expectedMtime !== 'number') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'path, content, expectedMtime required' } },
        { status: 400 },
      )
    }

    let safePath: string
    try {
      safePath = assertWithinProjectRoots(body.path, rt.config)
    } catch (err) {
      if (err instanceof PathSafetyError) {
        return NextResponse.json({ error: { code: 'FORBIDDEN', message: err.message } }, { status: 403 })
      }
      throw err
    }

    // mtime + content-hash check
    const stat = await fs.stat(safePath)
    if (stat.mtimeMs !== body.expectedMtime) {
      const current = await fs.readFile(safePath, 'utf8')
      return NextResponse.json(
        {
          error: { code: 'CONFLICT', message: 'on-disk mtime differs from expectedMtime' },
          mtime: stat.mtimeMs,
          content: current,
        },
        { status: 409 },
      )
    }
    if (body.expectedHash) {
      const current = await fs.readFile(safePath, 'utf8')
      if (sha1(current) !== body.expectedHash) {
        return NextResponse.json(
          {
            error: { code: 'CONFLICT', message: 'on-disk content hash differs from expectedHash' },
            mtime: stat.mtimeMs,
            content: current,
          },
          { status: 409 },
        )
      }
    }

    // Compare prev vs new status to know whether to emit a JOURNAL event
    const prevContent = await fs.readFile(safePath, 'utf8')
    const prevStatus = parseReadme(prevContent).frontMatter.status
    const nextStatus = parseReadme(body.content).frontMatter.status

    // Atomic write: temp file → rename
    const tmpPath = join(dirname(safePath), `.${Date.now()}.${Math.random().toString(36).slice(2)}.readme.tmp`)
    await fs.writeFile(tmpPath, body.content, 'utf8')
    await fs.rename(tmpPath, safePath)
    const newStat = await fs.stat(safePath)

    // Update index in-memory
    const expDir = dirname(safePath)
    const owningProject = rt.projectFor(expDir)
    if (owningProject) {
      try {
        const updatedExp = await readExperimentDir(expDir, owningProject.name)
        rt.index.set(updatedExp)
        rt.events.emit('experiment-change', {
          type: 'set',
          id: updatedExp.id,
          experiment: updatedExp,
        })
      } catch {
        // index update is best-effort; the write itself succeeded
      }

      // Emit [STATUS] event when status changed
      if (prevStatus !== nextStatus) {
        const expId = parseReadme(body.content).frontMatter.id
        await appendJournalEvent({
          path: join(owningProject.root, 'docs', 'journal.md'),
          event: {
            timestamp: nowIso(),
            tag: 'STATUS',
            body: `\`${expId}\` ${prevStatus} → ${nextStatus}`,
          },
        })
      }
    }

    return NextResponse.json({ mtime: newStat.mtimeMs })
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}

function nowIso(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const oh = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0')
  const om = String(Math.abs(offsetMin) % 60).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${oh}:${om}`
}
