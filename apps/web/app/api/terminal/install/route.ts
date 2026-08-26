// POST /api/terminal/install — standalone adapter over verified SHA256SUMS installation.

import { NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import {
  standaloneTerminal,
  standaloneTerminalError,
} from '../../../../lib/server/standalone-terminal'

export const dynamic = 'force-dynamic'

export async function POST() {
  const runtime = await getRuntime()
  const service = standaloneTerminal(runtime.config)
  try {
    return NextResponse.json(await service.install())
  } catch (error) {
    return standaloneTerminalError(error)
  }
}
