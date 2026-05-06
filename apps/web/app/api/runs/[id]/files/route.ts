// GET /api/runs/:id/files?depth=<n> — list files inside a run dir, capped
// at MAX_ENTRIES (default 200). Used by the per-run panel on the experiment
// detail page to render an "actual outputs" tree alongside the manual
// Artifacts section.

import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../lib/runtime'

export const dynamic = 'force-dynamic'

const DEFAULT_DEPTH = 3
const MAX_DEPTH = 6
const MAX_ENTRIES = 200

interface FileNode {
  type: 'file'
  path: string // relative to run dir
  size: number
  mtime: number
}
interface DirNode {
  type: 'dir'
  path: string
  children: Array<FileNode | DirNode>
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rt = await getRuntime()
    const run = rt.index.get(id)
    if (!run) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `run "${id}" not found` } },
        { status: 404 },
      )
    }
    const url = new URL(req.url)
    const depthParam = Number(url.searchParams.get('depth') ?? DEFAULT_DEPTH)
    const depth = Math.min(Math.max(1, depthParam | 0), MAX_DEPTH)

    let truncated = false
    let count = 0

    async function walk(absDir: string, depthLeft: number): Promise<DirNode | null> {
      if (depthLeft < 0) return null
      let entries: { name: string; isFile: boolean; isDir: boolean }[]
      try {
        const dirents = await fs.readdir(absDir, { withFileTypes: true })
        entries = dirents.map((d) => ({
          name: d.name,
          isFile: d.isFile(),
          isDir: d.isDirectory(),
        }))
      } catch {
        return null
      }
      const children: Array<FileNode | DirNode> = []
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (count >= MAX_ENTRIES) {
          truncated = true
          break
        }
        if (entry.name.startsWith('.')) continue
        const absChild = join(absDir, entry.name)
        if (entry.isFile) {
          let stat
          try {
            stat = await fs.stat(absChild)
          } catch {
            continue
          }
          children.push({
            type: 'file',
            path: relative(run!.path, absChild),
            size: stat.size,
            mtime: stat.mtimeMs,
          })
          count++
        } else if (entry.isDir) {
          const sub = await walk(absChild, depthLeft - 1)
          if (sub) {
            children.push(sub)
            count++
          }
        }
      }
      return { type: 'dir', path: relative(run!.path, absDir) || '.', children }
    }

    const tree = await walk(run.path, depth)
    return NextResponse.json({
      runId: run.id,
      runPath: run.path,
      depth,
      truncated,
      entries: count,
      tree: tree ?? { type: 'dir', path: '.', children: [] },
    })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
