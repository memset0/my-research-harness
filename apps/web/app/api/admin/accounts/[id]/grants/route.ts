// Super-admin account management: replace a user's Project / document grants.

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

const GrantsSchema = z
  .object({
    grants: z
      .array(
        z
          .object({
            host: z.string().min(1).max(128),
            project: z.string().min(1).max(128),
            document: z
              .object({ kind: z.enum(['report', 'wiki']), id: z.string().min(1).max(16) })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(256),
  })
  .strict()

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAccountStore(req, async (store) => {
    const id = parseAccountId((await params).id)
    if (id === null) return json({ error: { code: 'NOT_FOUND', message: 'no such account' } }, 404)
    const body = await parseBody(req, GrantsSchema)
    if (body instanceof Response) return body
    return json({ account: toAccountDto(await store.replaceGrants(id, body.grants)) })
  })
}
