import 'server-only'
import { toHttpError } from '@memon/backend'
import { NextResponse } from 'next/server'

/** Never turn a source outage into a missing resource or expose transport details. */
export function standaloneError(error: unknown): NextResponse {
  const mapped = toHttpError(error)
  return NextResponse.json(
    mapped?.body ?? {
      error: {
        code: mapped?.code ?? 'INTERNAL',
        message: mapped?.message ?? 'Project operation failed',
        ...(mapped?.retryable ? { retryable: true } : {}),
      },
    },
    { status: mapped?.status ?? 500, headers: { 'cache-control': 'no-store' } },
  )
}
