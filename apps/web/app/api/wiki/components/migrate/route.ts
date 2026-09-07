import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { migrateComponents } from '@/lib/wiki-components/registry'

export const dynamic = 'force-dynamic'

const MAX_CONTENT_BYTES = 4 * 1024 * 1024
const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' }

const RequestSchema = z.object({ content: z.string() }).strict()

/**
 * Rewrite every component block of a body to its pinned latest version:
 * unpinned blocks gain the pin, an older pinned block is carried through the
 * migration chain of its descriptors. The response is the whole body so the
 * caller (`memon wiki components migrate`) writes it back only when it
 * differs.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }

  const parsed = RequestSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'body must be {content: string}' } },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }

  if (Buffer.byteLength(parsed.data.content, 'utf8') > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'content must be at most 4 MiB' } },
      { status: 413, headers: RESPONSE_HEADERS },
    )
  }

  const { content } = migrateComponents(parsed.data.content)
  return NextResponse.json({ content }, { headers: RESPONSE_HEADERS })
}
