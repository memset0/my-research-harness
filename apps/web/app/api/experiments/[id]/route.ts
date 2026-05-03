import { NextResponse } from 'next/server'
import { isStaleRunning } from '@memon/core'
import { getRuntime } from '../../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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

    // User attention — reset backoff so subsequent polls are immediate
    rt.pokeById(id)

    return NextResponse.json({
      id: exp.id,
      path: exp.path,
      mtime: exp.mtime,
      hasReadme: exp.hasReadme,
      frontMatter: exp.frontMatter,
      sections: exp.sections,
      body: exp.body,
      parseErrors: exp.parseErrors,
      parseWarnings: exp.parseWarnings,
      stale: isStaleRunning(exp),
      // Resources hook: returns null in MVP, slot for future GPU/disk monitor
      resources: null,
    })
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}
