import { NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const rt = await getRuntime()
    return NextResponse.json({
      projects: rt.config.projects.map((p) => ({
        name: p.name,
        root: p.root,
        exclude: p.exclude,
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}
