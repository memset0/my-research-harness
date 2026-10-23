// @vitest-environment node
// Page paths are built only by `lib/project-routes.ts`. A retired
// `/h/<host>/p/<project>` or hostless `/p/<project>` builder anywhere else
// would still work through the redirect but emit a non-canonical link.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = join(__dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '.next', 'test', 'public'])
const ALLOWED = new Set(['lib/project-routes.ts'])
const RETIRED_BUILDER = /`\/[hp]\/\$\{|['"`]\/[hp]\/['"`]\s*\+|['"`]\/h\/['"`]|\/h\/\$\{/

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sources(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('page path literals', () => {
  it('builds no retired /h/ or /p/ page path outside the route module', () => {
    const offenders = sources(WEB_ROOT)
      .map((path) => relative(WEB_ROOT, path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) => RETIRED_BUILDER.test(readFileSync(join(WEB_ROOT, path), 'utf8')))
    expect(offenders).toEqual([])
  })
})
