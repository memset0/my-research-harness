import { type NextRequest, NextResponse } from 'next/server'
import { readIdentityFromRequest } from '@/lib/server/auth/request-context'
import { getRuntime } from '@/lib/server/runtime'
import { getUiPreferencesStore } from '@/lib/server/ui-preferences-store'

export const dynamic = 'force-dynamic'

const MAX_KEY_LENGTH = 512
const MAX_VALUE_BYTES = 256 * 1024
const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' }

function forbidden(): NextResponse {
  return NextResponse.json(
    { error: 'server preference storage is available only to the logged-in owner' },
    { status: 403, headers: RESPONSE_HEADERS },
  )
}

function validKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_KEY_LENGTH) {
    return false
  }
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return false
  }
  return true
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (readIdentityFromRequest(req).role !== 'owner') return forbidden()

  const key = req.nextUrl.searchParams.get('key')
  if (!validKey(key)) {
    return NextResponse.json(
      { error: 'key must be a non-empty printable string of at most 512 characters' },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }

  const runtime = await getRuntime()
  const result = await getUiPreferencesStore(runtime.configPath).get(runtime.auth.username, key)
  return NextResponse.json(result, { headers: RESPONSE_HEADERS })
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (readIdentityFromRequest(req).role !== 'owner') return forbidden()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid JSON body' },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'body must contain key and value' },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }

  const record = body as Record<string, unknown>
  if (!validKey(record.key) || !Object.hasOwn(record, 'value')) {
    return NextResponse.json(
      { error: 'body must contain a valid key and a JSON value' },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }

  let valueJson: string | undefined
  try {
    valueJson = JSON.stringify(record.value)
  } catch {
    valueJson = undefined
  }
  if (valueJson === undefined || Buffer.byteLength(valueJson, 'utf8') > MAX_VALUE_BYTES) {
    return NextResponse.json(
      { error: 'preference value must be JSON and at most 256 KiB' },
      { status: 413, headers: RESPONSE_HEADERS },
    )
  }

  const runtime = await getRuntime()
  const result = await getUiPreferencesStore(runtime.configPath).set(
    runtime.auth.username,
    record.key,
    record.value,
  )
  return NextResponse.json(result, { headers: RESPONSE_HEADERS })
}
