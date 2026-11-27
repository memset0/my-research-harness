// API tokens of the signed-in account (the super admin also sees every account's).
//
//   GET  → { tokens } (never values)
//   POST {name, expires_at?} → { token, value }: the value is shown here only

import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { json, tokenDto, withTokenAccount } from '@/lib/server/tokens-route'

export const dynamic = 'force-dynamic'

const CreateSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    expires_at: z
      .string()
      .regex(/(Z|[+-]\d{2}:\d{2})$/, 'expires_at needs a timezone offset')
      .optional(),
  })
  .strict()

export async function GET(req: NextRequest) {
  return withTokenAccount(req, async (store, account) => {
    const tokens = await store.listTokens(account.level === 'super_admin' ? undefined : account.id)
    return json({ tokens: tokens.map(tokenDto) })
  })
}

export async function POST(req: NextRequest) {
  return withTokenAccount(req, async (store, account) => {
    const parsed = CreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success)
      return json({ error: { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message } }, 400)
    const expires = parsed.data.expires_at === undefined ? null : Date.parse(parsed.data.expires_at)
    if (expires !== null && Number.isNaN(expires))
      return json({ error: { code: 'BAD_REQUEST', message: 'expires_at is not a date' } }, 400)
    const { token, value } = await store.createToken(account.id, parsed.data.name, expires)
    return json({ token: tokenDto(token), value }, 201)
  })
}
