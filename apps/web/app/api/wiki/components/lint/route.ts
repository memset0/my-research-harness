import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { lintComponents, listComponentBlocks } from '@/lib/wiki-components/registry'

export const dynamic = 'force-dynamic'

const MAX_CONTENT_BYTES = 4 * 1024 * 1024
const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' }

const RequestSchema = z
  .object({
    /** Page body, frontmatter included; only fenced blocks are inspected. */
    content: z.string(),
    /**
     * Bundle-relative paths that exist next to the page. `memon wiki lint`
     * sends the page bundle listing so a `data:` reference can be checked;
     * without it the reference is validated for shape only.
     */
    files: z.array(z.string()).optional(),
  })
  .strict()

/**
 * Component lint for a body the caller holds. The CLI and Backends parse only
 * the info string, so every `WIKI_COMPONENT_INVALID` / `WIKI_DATA_BLOCK_*`
 * diagnostic in a component payload is produced here.
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
      {
        error: {
          code: 'BAD_REQUEST',
          message: `body must be {content: string, files?: string[]}: ${parsed.error.issues[0]?.message ?? 'invalid body'}`,
        },
      },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }

  if (Buffer.byteLength(parsed.data.content, 'utf8') > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'content must be at most 4 MiB' } },
      { status: 413, headers: RESPONSE_HEADERS },
    )
  }

  const present = parsed.data.files ? new Set(parsed.data.files) : null
  const options = present ? { fileExists: (path: string) => present.has(path) } : undefined

  return NextResponse.json(
    {
      diagnostics: lintComponents(parsed.data.content, options),
      components: listComponentBlocks(parsed.data.content, options).map((block) => ({
        index: block.index,
        name: block.name,
        version: block.version,
        line: block.line,
        outdated: block.outdated,
      })),
    },
    { headers: RESPONSE_HEADERS },
  )
}
