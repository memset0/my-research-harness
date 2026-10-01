import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

/** Workspace packages whose TypeScript source a test config may alias to. */
export type WorkspacePackage = 'core' | 'backend' | 'skills' | 'cli' | 'test-utils'

/** Absolute path of a workspace package's `src/index.ts`, for source aliases. */
export function workspaceSource(pkg: WorkspacePackage): string {
  return here(`../../${pkg}/src/index.ts`)
}

/**
 * The one vitest preset every workspace package extends with
 * `mergeConfig(memonVitestPreset, defineConfig({ ... }))`. Packages add only
 * what is specific to them (environment, include globs, setup files, aliases).
 */
export const memonVitestPreset = defineConfig({
  resolve: {
    alias: {
      // Test-only workspace package: resolved here, never declared as a
      // dependency, so CLI-only installs never link it.
      '@memon/test-utils': here('./index.ts'),
      // Next's `server-only` guard only resolves inside the Next bundler.
      'server-only': here('./server-only-stub.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // CLI and route tests spawn processes and servers; one generous timeout
    // keeps every package alike.
    testTimeout: 30_000,
    reporters: ['default'],
  },
})
