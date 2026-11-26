// DELETE /api/shares/<id> — revoke one central share link: the super admin any,
// an admin only its own. The record is deleted, so its token stops validating.

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '@/lib/server/runtime'
import { shareManager, shareRegistry } from '@/lib/server/share-api'

export const dynamic = 'force-dynamic'

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const runtime = await getRuntime()
  const manager = await shareManager(req, runtime)
  if (!manager)
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'share management needs an admin account' } },
      { status: 403 },
    )
  const { id } = await ctx.params
  try {
    const registry = await shareRegistry(runtime)
    // Another creator's share answers like a missing one, revealing nothing.
    if (
      manager.kind === 'admin' &&
      (await registry.read()).find((record) => record.id === id)?.created_by !== manager.username
    )
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'share not found' } },
        { status: 404 },
      )
    if (!(await registry.remove(id)))
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'share not found' } },
        { status: 404 },
      )
    return NextResponse.json({ revoked: id })
  } catch {
    return NextResponse.json(
      { error: { code: 'UNAVAILABLE', message: 'share registry is unavailable' } },
      { status: 503 },
    )
  }
}
