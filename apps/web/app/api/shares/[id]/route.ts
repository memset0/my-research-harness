// DELETE /api/shares/<id> — owner-only revocation of one central share link.
// The record is deleted, so the next validation of its token fails.

import { type NextRequest, NextResponse } from 'next/server'
import { readIdentityFromRequest } from '@/lib/server/auth/request-context'
import { shareRegistry } from '@/lib/server/share-api'

export const dynamic = 'force-dynamic'

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (readIdentityFromRequest(req).role !== 'owner')
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'share management is owner-only' } },
      { status: 403 },
    )
  const { id } = await ctx.params
  try {
    if (!(await (await shareRegistry()).remove(id)))
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
