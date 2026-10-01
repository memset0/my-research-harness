// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// DTO modules are shared by route handlers and browser code, so they may only
// import types (web-lib-layering D3): no runtime import can drag server code
// or `@memon/core` JS into the client bundle.
const DTO_ROOT = __dirname
const IMPORT_RE = /^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gms

describe('lib/dto purity', () => {
  const files = readdirSync(DTO_ROOT).filter((name) => /^[a-z-]+\.ts$/.test(name))

  it('contains the shared DTO modules', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('imports types only, and never from server modules', () => {
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(join(DTO_ROOT, file), 'utf8')
      for (const match of source.matchAll(IMPORT_RE)) {
        const typeOnly = match[1]
        const specifier = match[2] ?? ''
        if (!typeOnly || specifier.includes('/server/') || specifier.startsWith('@memon/backend')) {
          offenders.push(`${file}: ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
