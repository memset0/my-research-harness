import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('Backend package boundary', () => {
  it('publishes one independent dist entry with no Web or human-auth dependency', async () => {
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

    const source = await Promise.all(
      ['index.ts', 'server.ts', 'project-service.ts'].map((name) =>
        readFile(join(packageRoot, 'src', name), 'utf8'),
      ),
    )
    expect(source.join('\n')).not.toMatch(/(?:from\s+['"]next|apps\/web|human-auth|basic-auth)/)
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
