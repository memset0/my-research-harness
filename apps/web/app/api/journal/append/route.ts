// POST /api/journal/append
//
// Body: { project: string, tag: string, body: string }
// Appends a new event with current local-time ISO8601 timestamp.
// Refuses to touch the frontmatter (last_digest_at).

import { join } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import { appendJournalEvent } from '@memon/core'
import { getRuntime } from '../../../../lib/runtime'

export const dynamic = 'force-dynamic'

interface AppendBody {
  project: string
  tag: string
  body: string
}

export async function POST(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const input = (await req.json()) as AppendBody
    if (!input.project || !input.tag || typeof input.body !== 'string') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'project, tag, body required' } },
        { status: 400 },
      )
    }
    if (input.tag === 'DIGEST') {
      // Reserved for digest agent; route does not allow it via this endpoint
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'digest mutations not allowed via append endpoint' } },
        { status: 403 },
      )
    }
    const project = rt.config.projects.find((p) => p.name === input.project)
    if (!project) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${input.project}" not configured` } },
        { status: 404 },
      )
    }
    const timestamp = nowIso()
    await appendJournalEvent({
      path: join(project.root, 'JOURNAL.md'),
      event: { timestamp, tag: input.tag, body: input.body },
    })
    return NextResponse.json({ appended: { timestamp, tag: input.tag, body: input.body } })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
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
