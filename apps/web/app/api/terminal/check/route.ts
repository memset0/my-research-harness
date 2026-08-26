// GET /api/terminal/check — standalone adapter over the shared terminal binary service.

import { NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import {
  standaloneTerminal,
  standaloneTerminalError,
} from '../../../../lib/server/standalone-terminal'

export const dynamic = 'force-dynamic'

export async function GET() {
  const runtime = await getRuntime()
  const service = standaloneTerminal(runtime.config)
  try {
    return NextResponse.json(await service.check())
  } catch (error) {
    return standaloneTerminalError(error)
  }
}
