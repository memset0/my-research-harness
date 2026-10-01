import path from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import { memonVitestPreset, workspaceSource } from '../../packages/test-utils/src/vitest-preset'

export default mergeConfig(
  memonVitestPreset,
  defineConfig({
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
        // Route tests exercise the backend services directly; resolve them from
        // source so a stale `packages/backend/dist` can never hide a regression.
        // Test-only: the Next build still uses the built package.
        '@memon/backend': workspaceSource('backend'),
      },
    },
    // React 19's automatic JSX runtime — no `import React from 'react'` needed.
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react',
    },
    test: {
      // jsdom stays the default; files that need no DOM declare
      // `// @vitest-environment node`.
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      include: ['**/*.test.{ts,tsx}'],
      exclude: ['node_modules/**', '.next/**', 'dist/**'],
      // Tailwind/PostCSS pipeline isn't needed for component tests — class-name
      // assertions don't require real styles.
      css: false,
    },
  }),
)
