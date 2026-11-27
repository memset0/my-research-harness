// DELETE /api/tokens/<id>: revoke one of the caller's tokens (any token for the super admin).

import type { NextRequest } from 'next/server'
import { json, withTokenAccount } from '@/lib/server/tokens-route'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id
  return withTokenAccount(req, async (store, account) => {
    const id = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null
    const revoked =
      id !== null &&
      (await store.revokeToken(id, account.level === 'super_admin' ? undefined : account.id))
    // Another account's token answers exactly like a missing one.
    if (!revoked) return json({ error: { code: 'NOT_FOUND', message: 'no such token' } }, 404)
    return json({ ok: true })
  })
}
