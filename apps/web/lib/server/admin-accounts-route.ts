import 'server-only'

import { type NextRequest, NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import type { AccountDto } from '../dto/accounts'
import { type Account, AccountStoreError, getAccountStore, SUPER_ADMIN_ID } from './account-store'
import type { Capability } from './auth/capabilities'
import { requestCan } from './auth/request-context'
import { getRuntime } from './runtime'

const HEADERS = { 'Cache-Control': 'no-store' }

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS })
}

export function toAccountDto(account: Account): AccountDto {
  return {
    id: account.id,
    username: account.username,
    level: account.level,
    disabled: account.disabled,
    managed_by_config: account.id === SUPER_ADMIN_ID,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
    grants: account.grants,
    admin_projects: account.adminProjects,
  }
}

const STATUS = { BAD_REQUEST: 400, NOT_FOUND: 404, CONFLICT: 409 } as const

/** Run a `manage_accounts` action against the store, mapping store errors to HTTP. */
export async function withAccountStore(
  req: NextRequest,
  action: (store: Awaited<ReturnType<typeof getAccountStore>>) => Promise<NextResponse>,
  capability: Capability = 'manage_accounts',
): Promise<NextResponse> {
  if (!requestCan(req, capability))
    return json({ error: { code: 'FORBIDDEN', message: `${capability} required` } }, 403)
  const runtime = await getRuntime()
  if (!runtime.configPath)
    return json({ error: { code: 'CONFIG_UNAVAILABLE', message: 'no instance config' } }, 503)
  try {
    return await action(await getAccountStore(runtime.configPath, runtime.auth.username))
  } catch (error) {
    if (error instanceof AccountStoreError)
      return json({ error: { code: error.code, message: error.message } }, STATUS[error.code])
    throw error
  }
}

export async function parseBody<T>(
  req: NextRequest,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const body = await req.json().catch(() => undefined)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return json(
      {
        error: { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message ?? 'invalid body' },
      },
      400,
    )
  return parsed.data
}

/** Host-qualified Projects this instance serves. */
export async function configuredProjects(): Promise<Array<{ host: string; project: string }>> {
  const runtime = await getRuntime()
  return runtime.config.projects.flatMap((project) =>
    project.host ? [{ host: project.host, project: project.name }] : [],
  )
}

export function parseAccountId(raw: string): number | null {
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null
}
