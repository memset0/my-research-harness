import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createBackendServer } from './server.js'

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
    expect(Object.keys(packageJson.dependencies ?? {})).toEqual(
      expect.arrayContaining(['@memon/core', 'http-proxy-3']),
    )
    expect(Object.keys(packageJson.dependencies ?? {})).not.toEqual(
      expect.arrayContaining(['next', 'react', '@memon/web']),
    )

    const source = await Promise.all(
      ['index.ts', 'server.ts', 'project-service.ts'].map((name) =>
        readFile(join(packageRoot, 'src', name), 'utf8'),
      ),
    )
    expect(source.join('\n')).not.toMatch(/(?:from\s+['"]next|apps\/web|human-auth|basic-auth)/)
    expect(createBackendServer).toBeTypeOf('function')
  })
})
