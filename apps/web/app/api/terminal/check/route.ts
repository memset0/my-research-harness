// GET /api/terminal/check — probe ttyd availability (cache → PATH).

import { NextResponse } from 'next/server'
import { probeTtyd } from '../../../../lib/terminal/binary'

export const dynamic = 'force-dynamic'

export async function GET() {
  const probe = await probeTtyd()
  return NextResponse.json(probe)
}
