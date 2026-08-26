// GET /api/terminal/list — shared singleton terminal lifecycle state.

import { NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import {
  standaloneTerminal,
  standaloneTerminalError,
  standaloneTerminalList,
} from '../../../../lib/server/standalone-terminal'

export const dynamic = 'force-dynamic'

export async function GET() {
  const runtime = await getRuntime()
  const service = standaloneTerminal(runtime.config)
  try {
    return NextResponse.json(standaloneTerminalList(service, await service.list()))
  } catch (error) {
    return standaloneTerminalError(error)
  }
}
