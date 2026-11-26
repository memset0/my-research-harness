// Super-admin account management: change level, disable/enable, reset password.

import type { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  json,
  parseAccountId,
  parseBody,
  toAccountDto,
  withAccountStore,
} from '@/lib/server/admin-accounts-route'

export const dynamic = 'force-dynamic'

const PatchSchema = z
  .object({
    level: z.enum(['admin', 'user', 'guest']).optional(),
    disabled: z.boolean().optional(),
    password: z.string().min(1).max(1024).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'nothing to change')

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAccountStore(req, async (store) => {
    const id = parseAccountId((await params).id)
    if (id === null) return json({ error: { code: 'NOT_FOUND', message: 'no such account' } }, 404)
    const body = await parseBody(req, PatchSchema)
    if (body instanceof Response) return body
    return json({ account: toAccountDto(await store.update(id, body)) })
  })
}
