// Map a concrete request path (e.g. `/api/runs/abc`) to the App Router route
// module that serves it, plus the extracted dynamic params — mirroring Next's
// filesystem routing so the headless node can dispatch RPC onto the SAME route
// handlers without a Next server or a hand-maintained route table.
//
// Matching precedence per segment (as in Next): exact name > single dynamic
// `[x]` > catch-all `[...x]`. See openspec/changes/add-hub-node-split.

import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// apps/web/lib/node -> apps/web/app/api
export const DEFAULT_API_ROOT = join(HERE, '..', '..', 'app', 'api')

export interface ResolvedRoute {
  /** Absolute path to the matched `route.ts`. */
  filePath: string
  /** Dynamic params extracted from the path (e.g. `{ id: 'abc' }`). */
  params: Record<string, string>
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

function routeFileIn(dir: string): string | null {
  for (const f of ['route.ts', 'route.tsx', 'route.js']) {
    const fp = join(dir, f)
    if (existsSync(fp)) return fp
  }
  return null
}

export function resolveRoute(
  path: string,
  apiRoot: string = DEFAULT_API_ROOT,
): ResolvedRoute | null {
  if (path !== '/api' && !path.startsWith('/api/')) return null
  const rest = path.replace(/^\/api\/?/, '')
  const segments = rest.length ? rest.split('/').filter(Boolean) : []
  const params: Record<string, string> = {}
  let dir = apiRoot

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const entries = subdirs(dir)

    // 1. exact segment match
    if (entries.includes(seg)) {
      dir = join(dir, seg)
      continue
    }
    // 2. catch-all [...name] — consumes all remaining segments
    const catchAll = entries.find((e) => /^\[\.\.\..+\]$/.test(e))
    if (catchAll) {
      params[catchAll.slice(4, -1)] = segments.slice(i).join('/')
      const fp = routeFileIn(join(dir, catchAll))
      return fp ? { filePath: fp, params } : null
    }
    // 3. single dynamic [name]
    const dyn = entries.find((e) => /^\[[^.][^\]]*\]$/.test(e))
    if (dyn) {
      params[dyn.slice(1, -1)] = seg
      dir = join(dir, dyn)
      continue
    }
    return null
  }

  const fp = routeFileIn(dir)
  return fp ? { filePath: fp, params } : null
}
