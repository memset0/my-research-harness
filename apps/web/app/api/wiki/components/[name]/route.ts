import { NextResponse } from 'next/server'
import { describeComponent, findComponent, listComponents } from '@/lib/wiki-components/registry'

export const dynamic = 'force-dynamic'

/**
 * `<name>` or `<name>@<N>`. Unpinned resolves to the latest registered
 * version, which is what an unpinned block in a page would render as.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const reference = (await context.params).name
  const descriptor = findComponent(reference)
  if (!descriptor) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `unknown component \`${reference}\`; registered: ${listComponents()
            .map((entry) => `${entry.name}@${entry.version}`)
            .join(', ')}`,
        },
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return NextResponse.json(describeComponent(descriptor), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
