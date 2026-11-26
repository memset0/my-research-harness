// Super-admin account management: list and create accounts.

import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { json, parseBody, toAccountDto, withAccountStore } from '@/lib/server/admin-accounts-route'

export const dynamic = 'force-dynamic'

const CreateSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(1024),
    level: z.enum(['admin', 'user', 'guest']),
  })
  .strict()

export async function GET(req: NextRequest) {
  return withAccountStore(req, async (store) =>
    json({ accounts: (await store.list()).map(toAccountDto) }),
  )
}

export async function POST(req: NextRequest) {
  return withAccountStore(req, async (store) => {
    const body = await parseBody(req, CreateSchema)
    if (body instanceof Response) return body
    return json({ account: toAccountDto(await store.create(body)) }, 201)
  })
}
