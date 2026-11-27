import 'server-only'

import { type NextRequest, NextResponse } from 'next/server'
import type { ApiTokenDto } from '@/lib/dto/tokens'
import { AccountStoreError, type ApiToken, getAccountStore } from '@/lib/server/account-store'
import { type RequestAccount, readAccountFromRequest } from '@/lib/server/auth/request-context'
import { getRuntime } from '@/lib/server/runtime'

const HEADERS = { 'Cache-Control': 'no-store' }

export function tokenDto(token: ApiToken): ApiTokenDto {
  return {
    id: token.id,
    username: token.username,
    name: token.name,
    prefix: token.prefix,
    created_at: token.createdAt,
    expires_at: token.expiresAt,
    last_used_at: token.lastUsedAt,
  }
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS })
}

/**
 * Run a token action for the signed-in account. Guests and anonymous callers
 * hold no tokens; the store is opened for the configured central only.
 */
export async function withTokenAccount(
  req: NextRequest,
  action: (
    store: Awaited<ReturnType<typeof getAccountStore>>,
    account: RequestAccount,
  ) => Promise<NextResponse>,
): Promise<NextResponse> {
  const account = readAccountFromRequest(req)
  if (!account || account.level === 'guest')
    return json(
      { error: { code: 'FORBIDDEN', message: 'API tokens need a signed-in account' } },
      403,
    )
  const runtime = await getRuntime()
  try {
    return await action(await getAccountStore(runtime.configPath, runtime.auth.username), account)
  } catch (error) {
    if (error instanceof AccountStoreError) {
      const status = { BAD_REQUEST: 400, NOT_FOUND: 404, CONFLICT: 409 }[error.code]
      return json({ error: { code: error.code, message: error.message } }, status)
    }
    throw error
  }
}
