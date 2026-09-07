import { NextResponse } from 'next/server'
import { describeComponent, listComponents } from '@/lib/wiki-components/registry'

export const dynamic = 'force-dynamic'

/**
 * The component registry lives only in the central web application, so this
 * is the single source the CLI (`memon wiki components ls`) and the
 * `memon-author-components` skill read. Every registered version is listed,
 * including outdated ones, because an old pinned block keeps rendering.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { components: listComponents().map(describeComponent) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
