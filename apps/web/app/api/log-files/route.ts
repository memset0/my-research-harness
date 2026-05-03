// GET /api/log-files?expPath=PATH
//
// Lists log-shaped files (.log/.txt/.out/.err) inside an experiment directory
// plus its `logs/` subdirectory (one level deep). Used by the LogViewer's
// multi-file tab strip.

import type { Dirent } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { PathSafetyError, assertWithinProjectRoots } from '../../../lib/path-safety'

export const dynamic = 'force-dynamic'

const LOG_EXTS = ['.log', '.txt', '.out', '.err'] as const

interface LogFileEntry {
  name: string
  path: string
  size: number
  mtime: number
}

async function scan(dir: string, results: LogFileEntry[]): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf-8' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const e of entries) {
    if (!e.isFile()) continue
    const name = String(e.name)
    const lower = name.toLowerCase()
    if (!LOG_EXTS.some((ext) => lower.endsWith(ext))) continue
    const full = join(dir, name)
    try {
      const st = await fs.stat(full)
      results.push({ name, path: full, size: st.size, mtime: st.mtimeMs })
    } catch {
      /* skip unreadable */
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const expPath = url.searchParams.get('expPath')
    if (!expPath) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'expPath query parameter required' } },
        { status: 400 },
      )
    }
    let safePath: string
    try {
      safePath = assertWithinProjectRoots(expPath, rt.config)
    } catch (err) {
      if (err instanceof PathSafetyError) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: err.message } },
          { status: 403 },
        )
      }
      throw err
    }

    const files: LogFileEntry[] = []
    await scan(safePath, files)
    await scan(join(safePath, 'logs'), files)

    files.sort((a, b) => b.mtime - a.mtime)

    return NextResponse.json({ files })
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 },
    )
  }
}
