// GET /api/log?path=PATH&endLine=N&count=C
//
// Returns lines [endLine - count + 1 .. endLine]. Path must be inside a
// configured project root (403 otherwise). LineIndex is built lazily and
// cached at the runtime level.

import { type NextRequest, NextResponse } from 'next/server'
import { LineIndex, defaultCacheDir, loadCache, saveCache } from '@memon/core'
import { getRuntime } from '../../../lib/runtime'
import { PathSafetyError, assertWithinProjectRoots } from '../../../lib/path-safety'

export const dynamic = 'force-dynamic'

const indexCache = new Map<string, Promise<LineIndex>>()

async function getOrBuild(path: string): Promise<LineIndex> {
  let p = indexCache.get(path)
  if (!p) {
    p = (async () => {
      const cached = await loadCache(path, { dir: defaultCacheDir() })
      if (cached) return cached
      const built = await LineIndex.build(path)
      void saveCache(built, { dir: defaultCacheDir() }).catch(() => undefined)
      return built
    })()
    indexCache.set(path, p)
  }
  return p
}

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const path = url.searchParams.get('path')
    const endLineParam = url.searchParams.get('endLine')
    const countParam = url.searchParams.get('count')
    if (!path) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'path query parameter required' } },
        { status: 400 },
      )
    }

    let safePath: string
    try {
      safePath = assertWithinProjectRoots(path, rt.config)
    } catch (err) {
      if (err instanceof PathSafetyError) {
        return NextResponse.json({ error: { code: 'FORBIDDEN', message: err.message } }, { status: 403 })
      }
      throw err
    }

    const index = await getOrBuild(safePath)
    // Refresh in case the file grew since last build / load
    const append = await index.appendDelta()
    if (append.rotated) {
      indexCache.delete(safePath)
      const fresh = await getOrBuild(safePath)
      const endLine = endLineParam ? Number(endLineParam) : fresh.totalLines
      const count = countParam ? Number(countParam) : 100
      const lines = await fresh.range(endLine, count)
      return NextResponse.json({ totalLines: fresh.totalLines, lines })
    }

    const endLine = endLineParam ? Number(endLineParam) : index.totalLines
    const count = countParam ? Number(countParam) : 100
    const lines = await index.range(endLine, count)
    return NextResponse.json({ totalLines: index.totalLines, lines })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
