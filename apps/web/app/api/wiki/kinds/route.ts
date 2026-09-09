import { WIKI_KIND_REGISTRY } from '@memon/core'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(WIKI_KIND_REGISTRY, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
