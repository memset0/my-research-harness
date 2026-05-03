import { type NextRequest, NextResponse } from 'next/server'
import { isStaleRunning } from '@memon/core'
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
