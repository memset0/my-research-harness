// Owner-only explicit restart for saved File access settings.
//
//   POST /api/file-access/restart
//
// The request body is never read: the only command this endpoint can run is the
// machine-local `fileAccessRestart` argv from the instance config, executed
// verbatim without a shell. When no adapter is configured (or the configured
// argv is malformed) the response says a manual restart is required instead of
// claiming success.
//
// The restart is scheduled a few hundred milliseconds after this response is
// produced, so the browser learns the outcome before the process goes away.

import { type NextRequest, NextResponse } from 'next/server'
import { readIdentityFromRequest } from '@/lib/auth/request-context'
import { getRuntime, type Runtime } from '@/lib/runtime'
import { resolveRestartAdapter, scheduleFileAccessRestart } from '@/lib/server/file-access-settings'

export const dynamic = 'force-dynamic'

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (readIdentityFromRequest(req).role !== 'owner') {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'restarting the service is available only to the logged-in owner',
        },
      },
      { status: 403, headers: RESPONSE_HEADERS },
    )
  }

  let runtime: Runtime
  try {
    runtime = await getRuntime()
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'CONFIG_UNAVAILABLE',
          message: 'the instance configuration is unavailable, so no restart adapter can be used',
        },
      },
      { status: 503, headers: RESPONSE_HEADERS },
    )
  }

  const adapter = resolveRestartAdapter(runtime.config)
  const outcome = scheduleFileAccessRestart(adapter, { configPath: runtime.configPath })

  // The adapter argv is machine-local operator configuration and is never
  // echoed back to the browser.
  return NextResponse.json(
    outcome.ok
      ? { ok: true, code: outcome.code, restartAvailable: true, delayMs: outcome.delayMs }
      : { ok: false, code: outcome.code, restartAvailable: false, message: outcome.message },
    { headers: RESPONSE_HEADERS },
  )
}
