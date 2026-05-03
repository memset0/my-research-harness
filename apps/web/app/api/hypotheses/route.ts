// GET /api/hypotheses?project=NAME
//
// Returns the parsed HYPOTHESES.md for the given project (required parameter).

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import { parseHypotheses } from '@memon/core'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const projectName = url.searchParams.get('project')
    if (!projectName) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'project query parameter is required' } },
        { status: 400 },
      )
    }
    const project = rt.config.projects.find((p) => p.name === projectName)
    if (!project) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }
    const path = join(project.root, 'HYPOTHESES.md')
    let content: string
    try {
      content = await fs.readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return NextResponse.json({
          path,
          legendBlock: null,
          summaryTableBlock: null,
          entries: [],
          parseErrors: [],
          parseWarnings: [],
        })
      }
      throw err
    }
    const parsed = parseHypotheses(content)
    return NextResponse.json({ path, ...parsed })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
