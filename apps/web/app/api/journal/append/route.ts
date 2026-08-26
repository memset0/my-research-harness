import { BackendMutationError } from '@memon/backend'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import { refreshStandaloneJournal } from '../../../../lib/server/standalone-mutation-refresh'
import { standaloneServices } from '../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

interface AppendBody {
  project: string
  tag: string
  body: string
}

export async function POST(req: NextRequest) {
  const runtime = await getRuntime()
  const input = (await req.json().catch(() => null)) as AppendBody | null
  if (!input?.project || !input.tag || typeof input.body !== 'string') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'project, tag, body required' } },
      { status: 400 },
    )
  }
  try {
    const result = await standaloneServices(runtime.config).mutations.appendJournal(
      input.project,
      input,
    )
    await refreshStandaloneJournal(runtime, input.project)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof BackendMutationError) {
      if (error.code === 'FORBIDDEN') {
        return NextResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'digest mutations not allowed via append endpoint',
            },
          },
          { status: 403 },
        )
      }
      if (error.code === 'PROJECT_NOT_FOUND') {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: `project "${input.project}" not configured` } },
          { status: 404 },
        )
      }
    }
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 })
  }
}
