import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Web, React and human-auth modules neither Backend nor Core may import. */
const FORBIDDEN_IMPORT =
  /^(?:next(?:\/|$)|react(?:-dom)?(?:\/|$)|@memon\/web(?:\/|$))|apps\/web|human-auth|basic-auth/

/** Every non-test TypeScript source file under `root`. */
async function sourceFiles(root: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

/** Module specifiers of static imports, re-exports and dynamic imports. */
function importSpecifiers(source: string): string[] {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm
  return [...source.matchAll(pattern)].map((match) => match[1]!)
}

describe('Backend package boundary', () => {
  it('publishes one independent dist entry with no Web or human-auth dependency in any Backend or Core source file', async () => {
    const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      main?: string
      files?: string[]
      exports?: Record<string, { import?: string }>
      dependencies?: Record<string, string>
    }
    expect(packageJson.main).toBe('./dist/index.js')
    expect(packageJson.exports?.['.']?.import).toBe('./dist/index.js')
    expect(packageJson.files).toEqual(['dist'])
    expect(Object.keys(packageJson.dependencies ?? {})).toContain('@memon/core')
    expect(Object.keys(packageJson.dependencies ?? {})).not.toEqual(
      expect.arrayContaining(['next', 'react', '@memon/web']),
    )

    for (const root of [join(packageRoot, 'src'), join(packageRoot, '..', 'core', 'src')]) {
      const files = await sourceFiles(root)
      expect(files.length).toBeGreaterThan(10)
      const offenders: string[] = []
      for (const file of files) {
        for (const specifier of importSpecifiers(await readFile(file, 'utf8'))) {
          if (FORBIDDEN_IMPORT.test(specifier)) offenders.push(`${file}: ${specifier}`)
        }
      }
      expect(offenders).toEqual([])
    }
  })

  it('ships no retired daemon, distribution, update or start-guard lifecycle', async () => {
    const entries = await readdir(join(packageRoot, 'src'))
    expect(entries).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(daemon|distribution|update|start-guards)/)]),
    )
    const backend = await import('./index.js')
    for (const name of Object.keys(backend)) {
      expect(name).not.toMatch(/Daemon|ReleaseStore|BackendRelease|StartGuard|UpdateActivation/)
    }
  })
})
