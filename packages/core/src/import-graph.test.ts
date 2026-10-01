// Guards the layering that breaks the Project file store ↔ git command cycle:
// the store and the git cache meet only in the leaf `project-file-context.ts`.

import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))

/** Relative module specifiers a source file imports or re-exports (type-only included). */
function localImports(file: string): string[] {
  const source = readFileSync(join(SRC, file), 'utf8')
  const out: string[] = []
  const pattern =
    /(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2]!
    const target = relative(SRC, resolve(SRC, dirname(file), specifier)).replace(/\.js$/, '.ts')
    out.push(target.split('\\').join('/'))
  }
  return out
}

function reachable(from: string): Set<string> {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const file = stack.pop()!
    for (const next of localImports(file)) {
      if (seen.has(next)) continue
      seen.add(next)
      stack.push(next)
    }
  }
  return seen
}

describe('core import layering', () => {
  it('git/command.ts does not import the Project file store', () => {
    expect(localImports('git/command.ts')).not.toContain('project-file-store.ts')
    expect(reachable('git/command.ts')).not.toContain('project-file-store.ts')
  })

  it('the Project file store does not import the git layer', () => {
    expect(localImports('project-file-store.ts').filter((path) => path.startsWith('git/'))).toEqual(
      [],
    )
  })

  it('types.ts does not import the Project file store', () => {
    expect(localImports('types.ts')).not.toContain('project-file-store.ts')
    expect(reachable('types.ts')).not.toContain('project-file-store.ts')
  })

  it('the shared context module is a leaf', () => {
    expect(localImports('project-file-context.ts')).toEqual([])
  })

  it('the parser sees the edges it guards', () => {
    expect(localImports('git/command.ts')).toContain('project-file-context.ts')
    expect(localImports('project-file-store.ts')).toContain('project-file-context.ts')
  })
})
